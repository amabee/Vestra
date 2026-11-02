import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-settings-health-"));
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  stdin: {
    contents: `export {createSettingsPatcher} from './apps/nova/electron/settings-service';export {PlaybackDiagnostics} from './apps/nova/electron/playback-diagnostics';export {MemoryDriver,getSettings} from './packages/storage/src/index';`,
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "test.cjs"),
});
const {
  createSettingsPatcher,
  PlaybackDiagnostics,
  MemoryDriver,
  getSettings,
} = createRequire(import.meta.url)(join(scratch, "test.cjs"));
test("legacy settings keep saved values and gain app/UI defaults", async () => {
  const driver = new MemoryDriver();
  await driver.write("settings", {
    version: 1,
    appearance: { theme: "system", accent: "rose" },
    playback: { autoplayNext: false },
    downloads: { category: "mine" },
  });
  const settings = await getSettings(driver);
  assert.equal(settings.app.startupPage, "/");
  assert.equal(settings.app.showStatusBar, true);
  assert.equal(settings.appearance.customizeAccent, false);
  assert.equal(settings.appearance.textScale, "default");
  assert.equal(settings.appearance.theme, "system");
  assert.equal(settings.playback.autoplayNext, false);
  assert.equal(settings.downloads.category, "mine");
});
test("concurrent patches preserve unrelated sections; rejected writes do not poison later saves", async () => {
  const driver = new MemoryDriver();
  let notified = 0;
  const patch = createSettingsPatcher(driver, () => notified++);
  await Promise.all([
    patch({ appearance: { theme: "light" } }),
    patch({ appearance: { sidebarLabels: true } }),
    patch({ downloads: { category: "personal" } }),
  ]);
  let value = await getSettings(driver);
  assert.equal(value.appearance.theme, "light");
  assert.equal(value.appearance.sidebarLabels, true);
  assert.equal(value.downloads.category, "personal");
  assert.equal(notified, 3);
  assert.throws(() => patch({ appearance: { theme: "unknown" } }));
  assert.throws(() => patch({ downloads: { category: " " } }));
  assert.throws(() => patch({ library: { folders: [] } }));
  const write = driver.write.bind(driver);
  driver.write = async () => {
    throw Error("disk unavailable");
  };
  await assert.rejects(patch({ appearance: { theme: "dark" } }), /disk/);
  assert.equal(notified, 3);
  driver.write = write;
  await patch({ app: { showStatusBar: false } });
  value = await getSettings(driver);
  assert.equal(value.appearance.theme, "light");
  assert.equal(value.app.showStatusBar, false);
});
test("session diagnostics redact sensitive request details and stay bounded", () => {
  const log = new PlaybackDiagnostics();
  const row = log.failure(
    "open",
    Error(
      "Fetch https://host.example/private/path?token=secret failed C:\\Users\\User\\video.mkv",
    ),
    "fixture",
  );
  assert.doesNotMatch(
    row.detail,
    /host.example|private|secret|Users|video.mkv/,
  );
  const quoted = log.failure(
    "source",
    Error(
      'password="private value" token=secret {"api_key":"another secret"} Bearer bearer-secret',
    ),
  );
  assert.doesNotMatch(
    quoted.detail,
    /private value|another secret|bearer-secret|token=secret/,
  );
  for (let i = 0; i < 60; i++) log.failure("open", Error("fixture"));
  assert.equal(log.list().length, 50);
  log.list()[0].detail = "mutated";
  assert.notEqual(log.list()[0].detail, "mutated");
  log.observe("source", Date.now() - 40, Error("worker stopped"));
  assert.equal(log.observation("source").state, "failed");
  log.observe("source", Date.now() - 5);
  assert.equal(log.observation("source").state, "resolved");
  assert.equal(log.observation("source").code, undefined);
  log.observe(
    "source",
    Date.now(),
    new DOMException("The operation was aborted", "AbortError"),
  );
  assert.equal(log.observation("source").state, "resolved");
  log.observe(
    "source",
    Date.now(),
    new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError",
    ),
  );
  assert.equal(log.observation("source").code, "timeout");
});
