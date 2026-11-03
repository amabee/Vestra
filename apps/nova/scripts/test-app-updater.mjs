import { build } from "esbuild";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test, after } from "node:test";
import { validateRelease } from "./validate-release.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(
  join(root, "apps/nova/node_modules/.updater-test-"),
);
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  stdin: {
    contents:
      "export {UpdateController} from './apps/nova/electron/update-controller';",
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "controller.cjs"),
});
const { UpdateController } = createRequire(import.meta.url)(
  join(scratch, "controller.cjs"),
);
class Engine extends EventEmitter {
  checks = 0;
  downloads = 0;
  installs = 0;
  version = "0.1.3";
  async checkForUpdates() {
    this.checks++;
    this.emit("update-available", {
      version: this.version,
      releaseNotes: "Changes",
    });
    return {};
  }
  async downloadUpdate() {
    this.downloads++;
    this.emit("download-progress", {
      percent: 50,
      transferred: 50,
      total: 100,
      bytesPerSecond: 25,
    });
    this.emit("update-downloaded", { version: this.version });
    return ["not-a-real-installer.exe"];
  }
  quitAndInstall(silent, restart) {
    assert.equal(silent, false);
    assert.equal(restart, true);
    this.installs++;
  }
}
test("real electron-updater version policy accepts patch, minor and major; rejects older versions", async () => {
  const require = createRequire(import.meta.url);
  const { NsisUpdater } = require("electron-updater");
  const adapter = {
    version: "0.1.2",
    name: "Vestra updater test",
    isPackaged: true,
    appUpdateConfigPath: join(scratch, "unused.yml"),
    userDataPath: scratch,
    baseCachePath: scratch,
    whenReady: async () => {},
    relaunch: () => {},
    quit: () => {
      throw Error("Tests must not quit/install");
    },
    onQuit: () => {},
  };
  const engine = new NsisUpdater(null, adapter);
  const controller = new UpdateController(engine, "0.1.2", () => {});
  try {
    for (const version of ["0.1.3", "0.2.0", "1.0.0"])
      assert.equal(
        await engine.isUpdateAvailable({ version, files: [] }),
        true,
      );
    for (const version of ["0.1.1", "0.1.2"])
      assert.equal(
        await engine.isUpdateAvailable({ version, files: [] }),
        false,
      );
  } finally {
    controller.dispose();
  }
});
test("source runs expose disabled status and cannot check/download/install", async () => {
  const c = new UpdateController(null, "0.1.2", () => {});
  c.start();
  assert.equal((await c.check()).phase, "disabled");
  assert.equal((await c.download()).phase, "disabled");
  assert.equal(c.install().phase, "disabled");
  c.dispose();
});
for (const version of ["0.1.3", "0.2.0", "1.0.0"]) {
  test(`patch/minor/major update flow ${version} requires explicit download and install`, async () => {
    const e = new Engine();
    e.version = version;
    const seen = [];
    const c = new UpdateController(e, "0.1.2", (s) => seen.push(s));
    assert.equal(e.autoDownload, false);
    assert.equal(e.autoInstallOnAppQuit, false);
    assert.equal(e.allowPrerelease, false);
    assert.equal(e.allowDowngrade, false);
    c.install();
    await c.download();
    assert.equal(e.installs, 0);
    assert.equal(e.downloads, 0);
    const available = await c.check();
    assert.equal(available.phase, "available");
    assert.equal(available.version, version);
    assert.equal(e.downloads, 0);
    await c.check();
    assert.equal(e.checks, 2);
    assert.equal((await c.download()).phase, "downloaded");
    assert.equal(e.installs, 0);
    await c.check();
    assert.equal(e.checks, 2);
    assert(
      seen.some((s) => s.phase === "downloading" && s.progress.percent === 50),
    );
    c.install();
    c.install();
    assert.equal(e.installs, 1);
    c.dispose();
    assert.equal(e.listenerCount("download-progress"), 0);
  });
}
test("concurrent checks are coalesced; download failures can retry", async () => {
  const e = new Engine();
  let finish;
  e.checkForUpdates = () => {
    e.checks++;
    return new Promise((r) => (finish = r));
  };
  const c = new UpdateController(e, "0.1.2", () => {});
  const check = c.check();
  assert.equal((await c.check()).phase, "checking");
  assert.equal(e.checks, 1);
  e.emit("update-available", { version: "0.2.0" });
  finish({});
  await check;
  e.downloadUpdate = async () => {
    e.downloads++;
    throw Error("https://secret.invalid/?token=private");
  };
  const failed = await c.download();
  assert.equal(failed.phase, "error");
  assert(!JSON.stringify(failed).includes("private"));
  assert.equal(e.installs, 0);
  e.downloadUpdate = Engine.prototype.downloadUpdate.bind(e);
  assert.equal((await c.download()).phase, "downloaded");
  assert.equal(e.downloads, 2);
  c.dispose();
});
test("no update and missing feed have distinct states; snapshots are detached", async () => {
  const e = new Engine();
  e.checkForUpdates = async () => {
    e.emit("update-not-available", {});
    return {};
  };
  const c = new UpdateController(e, "0.1.2", () => {});
  assert.equal((await c.check()).phase, "current");
  e.checkForUpdates = async () => {
    const error = Object.assign(Error("unpublished"), {
      code: "ERR_UPDATER_LATEST_VERSION_NOT_FOUND",
    });
    e.emit("error", error);
    throw error;
  };
  const s = await c.check();
  assert.equal(s.phase, "error");
  assert.match(s.message, /feed/);
  s.currentVersion = "tampered";
  assert.equal(c.snapshot().currentVersion, "0.1.2");
  c.dispose();
});
test("malformed progress and long release notes are bounded", async () => {
  const e = new Engine();
  const c = new UpdateController(e, "0.1.2", () => {});
  e.emit("update-available", {
    version: "1.0.0",
    releaseNotes: "x".repeat(20000),
  });
  assert.equal(c.snapshot().releaseNotes.length, 6000);
  e.downloadUpdate = async () => {
    e.emit("download-progress", {
      percent: 200,
      transferred: -1,
      total: NaN,
      bytesPerSecond: Infinity,
    });
    return [];
  };
  await c.download();
  assert.deepEqual(c.snapshot().progress, {
    percent: 100,
    transferred: 0,
    total: 0,
    bytesPerSecond: 0,
  });
  c.dispose();
});
test("release artifact verification rejects version/hash/path/feed mismatches", async () => {
  const folder = join(scratch, "release"),
    version = "1.2.3",
    name = `Vestra-Nova-${version}-Setup-x64.exe`;
  await mkdir(join(folder, "win-unpacked/resources"), { recursive: true });
  const bytes = Buffer.from("MZ installer fixture"),
    sha512 = createHash("sha512").update(bytes).digest("base64");
  const feed = {
    version,
    path: name,
    sha512,
    files: [{ url: name, size: bytes.length, sha512 }],
  };
  const writeFeed = () =>
    writeFile(join(folder, "latest.yml"), JSON.stringify(feed));
  await writeFile(join(folder, name), bytes);
  await writeFile(join(folder, name + ".blockmap"), "blockmap-fixture");
  await writeFeed();
  const config = join(folder, "win-unpacked/resources/app-update.yml");
  await writeFile(
    config,
    JSON.stringify({ provider: "github", owner: "amabee", repo: "Vestra" }),
  );
  assert.equal(
    (await validateRelease(folder, version, "v1.2.3")).version,
    version,
  );
  await assert.rejects(
    () => validateRelease(folder, version, "v1.2.3", "Vestra Fixture"),
    /publisher/,
  );
  await writeFile(
    config,
    JSON.stringify({
      provider: "github",
      owner: "amabee",
      repo: "Vestra",
      publisherName: ["Vestra Fixture"],
    }),
  );
  assert.equal(
    (await validateRelease(folder, version, "v1.2.3", "Vestra Fixture"))
      .version,
    version,
  );
  await assert.rejects(
    () => validateRelease(folder, version, "v1.2.3", "Wrong Publisher"),
    /publisher/,
  );
  await writeFile(
    config,
    JSON.stringify({
      provider: "github",
      owner: "amabee",
      repo: "Vestra",
      publisherName: ["Vestra Fixture"],
      verifyUpdateCodeSignature: false,
    }),
  );
  await assert.rejects(
    () => validateRelease(folder, version, "v1.2.3", "Vestra Fixture"),
    /publisher/,
  );
  await writeFile(
    config,
    JSON.stringify({ provider: "github", owner: "amabee", repo: "Vestra" }),
  );
  await assert.rejects(() => validateRelease(folder, version, "v1.2.4"), /tag/);
  await assert.rejects(() => validateRelease(folder, "1.2.3-beta.1"), /stable/);
  feed.files[0].url = "../installer.exe";
  await writeFeed();
  await assert.rejects(() => validateRelease(folder, version), /path/);
  feed.files[0].url = name;
  feed.files[0].sha512 = "bad";
  await writeFeed();
  await assert.rejects(() => validateRelease(folder, version), /SHA-512/);
  feed.files[0].sha512 = sha512;
  await writeFeed();
  await writeFile(
    config,
    JSON.stringify({ provider: "generic", url: "https://wrong.invalid" }),
  );
  await assert.rejects(() => validateRelease(folder, version), /feed/);
});
test("release workflow stages artifacts as a draft and never publishes during builds", async () => {
  const require = createRequire(import.meta.url);
  const { load } = createRequire(
    require.resolve("electron-updater/package.json"),
  )("js-yaml");
  const workflow = load(
    await readFile(join(root, ".github/workflows/nova-release.yml"), "utf8"),
  );
  assert(workflow.on.push.tags.includes("v[0-9]*"));
  const steps = workflow.jobs.windows.steps;
  assert(steps.some((s) => s.run?.includes("--draft")));
  const config = JSON.parse(
    await readFile(join(root, "apps/nova/package.json"), "utf8"),
  );
  assert.match(config.scripts["release:build"], /--publish never/);
  assert.equal(config.build.win.target[0].target, "nsis");
  assert.equal(config.build.nsis.deleteAppDataOnUninstall, false);
});
