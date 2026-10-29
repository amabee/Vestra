import { build } from "esbuild";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-remote-sources-"));
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  entryPoints: {
    manager: join(root, "apps/nova/electron/source-manager.ts"),
    remote: join(root, "apps/nova/electron/source-remote.ts"),
    storage: join(root, "packages/storage/src/index.ts"),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outdir: scratch,
});
const require = createRequire(import.meta.url);
const { SourceManager } = require(join(scratch, "manager.js"));
const { RemoteSourceService } = require(join(scratch, "remote.js"));
const { MemoryDriver } = require(join(scratch, "storage.js"));
const url = "https://registry.example/manifest.json";
const payload = "https://cdn.example/provider.js";
const digest = (text) => createHash("sha256").update(text).digest("hex");
async function fixture() {
  const active = new Map();
  const driver = new MemoryDriver();
  const manager = new SourceManager(driver, {
    async activate(row) {
      active.set(row.id, row);
    },
    async deactivate(id) {
      active.delete(id);
    },
    async check() {
      return { episodeServers: ["default"] };
    },
  });
  await manager.initialize(async () => []);
  const files = new Map();
  const requests = [];
  let time = 1000;
  const service = new RemoteSourceService(
    manager,
    async (address) => {
      requests.push(address);
      const bytes = files.get(address);
      if (!bytes) throw new Error("Missing fixture");
      return bytes;
    },
    () => time,
  );
  function version(value, code = `// ${value}`, extra = {}) {
    files.set(
      url,
      Buffer.from(
        JSON.stringify({
          id: "fixture",
          name: "Fixture",
          type: "manga-provider",
          version: value,
          payloadURI: payload,
          hosts: ["manga.example"],
          sha256: digest(code),
          ...extra,
        }),
      ),
    );
    files.set(payload, Buffer.from(code));
  }
  version("1.0.0");
  return {
    manager,
    driver,
    service,
    active,
    files,
    requests,
    version,
    expire: () => {
      time += 600001;
    },
  };
}
test("remote preparation is read-only, pins bytes, and installs reviewed host grants", async () => {
  const f = await fixture();
  const plan = await f.service.prepare(url);
  assert.equal(plan.checksumVerified, true);
  assert.deepEqual(await f.manager.list(), []);
  assert.equal(f.active.size, 0);
  f.files.set(payload, Buffer.from("changed after preview"));
  await f.service.apply(plan.token, ["approved.example"]);
  assert.equal(f.active.get("fixture").source, "// 1.0.0");
  const installed = (await f.manager.list())[0];
  assert.deepEqual(installed.hosts, ["approved.example"]);
  assert.equal(installed.remote.manifestUrl, url);
  assert.equal(installed.remote.version, "1.0.0");
});
test("updates keep preferences and identity, retain history, and restore previous versions", async () => {
  const f = await fixture();
  await f.service.apply((await f.service.prepare(url)).token, [
    "manga.example",
  ]);
  const first = (await f.manager.list())[0];
  await f.manager.update(first.id, {
    ...first,
    preferences: { language: "en" },
    enabled: false,
  });
  f.version("2.0.0", "// two", {
    hosts: ["new.example"],
    preferences: { language: "changed" },
  });
  const update = await f.service.check(first.id);
  assert.deepEqual(update.addedHosts, ["new.example"]);
  await f.service.apply(update.token, update.hosts);
  const current = (await f.manager.list())[0];
  assert.equal(current.remote.version, "2.0.0");
  assert.equal(current.enabled, false);
  assert.deepEqual(current.preferences, { language: "en" });
  assert.equal(f.active.size, 0);
  await f.manager.rollback(
    current.id,
    current.versions[0].id,
    current.sourceHash,
  );
  const restored = (await f.manager.list())[0];
  assert.equal(restored.remote.version, "1.0.0");
  assert.deepEqual(restored.hosts, current.hosts);
  assert.deepEqual(restored.preferences, current.preferences);
});
test("checksum mismatch, unsafe URLs and oversized manifests are rejected before installation", async () => {
  const f = await fixture();
  f.version("1", "code", { sha256: "0".repeat(64) });
  await assert.rejects(f.service.prepare(url), /SHA256/);
  for (const address of [
    "http://registry.example/x",
    "https://user:pass@registry.example/x",
    "https://registry.example:8443/x",
    url + "#fragment",
  ])
    await assert.rejects(f.service.prepare(address));
  f.files.set(url, Buffer.alloc(65537));
  await assert.rejects(f.service.prepare(url), /65536/);
  assert.deepEqual(await f.manager.list(), []);
});
test("remote identity changes, expired reviews, and stale update plans cannot overwrite installed sources", async () => {
  const f = await fixture();
  await f.service.apply((await f.service.prepare(url)).token, []);
  f.version("2", "two", { id: "different" });
  await assert.rejects(f.service.check("fixture"), /identity/);
  f.version("2", "two");
  const plan = await f.service.check("fixture");
  const duplicate = await f.service.check("fixture");
  await f.service.apply(plan.token, []);
  await assert.rejects(f.service.apply(duplicate.token, []), /Source changed/);
  const expired = await f.service.check("fixture");
  f.expire();
  await assert.rejects(f.service.apply(expired.token, []), /expired/);
});
test("same-version drift is visible and retained history is bounded across restarts", async () => {
  const f = await fixture();
  await f.service.apply((await f.service.prepare(url)).token, []);
  assert.equal((await f.service.check("fixture")).changed, false);
  for (let i = 0; i < 5; i++) {
    f.version("1.0.0", `// drift ${i}`);
    const plan = await f.service.check("fixture");
    assert.equal(plan.changed, true);
    await f.service.apply(plan.token, []);
  }
  const restarted = new SourceManager(f.driver, {
    async activate() {},
    async deactivate() {},
    async check() {
      return {};
    },
  });
  await restarted.initialize(async () => []);
  assert.equal((await restarted.list())[0].versions.length, 3);
});
