import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-sources-"));
await build({
  entryPoints: {
    manager: join(root, "apps/nova/electron/source-manager.ts"),
    storage: join(root, "packages/storage/src/index.ts"),
    worker: join(root, "apps/nova/electron/csharp-worker.ts"),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outdir: scratch,
});
const require = createRequire(import.meta.url);
const { SourceManager } = require(join(scratch, "manager.js"));
const { NodeDriver, MemoryDriver } = require(join(scratch, "storage.js"));
const { CSharpProviderSession } = require(join(scratch, "worker.js"));
after(() => rm(scratch, { recursive: true, force: true }));
const script = `class Provider {
  getSettings(){return {episodeServers:['one','two'], supportsDub:false};}
  search(){return [];}
  findEpisodes(){return [];}
  findEpisodeServer(){return {server:'one',videoSources:[]};}
}`;
const row = (id = "fixture") => ({
  id,
  name: "Fixture",
  type: "onlinestream-provider",
  hosts: ["fixture.example"],
  preferences: {},
  filename: "provider.js",
  source: script,
  enabled: true,
});
function runtime() {
  const active = new Map();
  return {
    active,
    async activate(r) {
      if (r.id === "broken") throw new Error("Invalid provider");
      active.set(r.id, r);
    },
    async deactivate(id) {
      active.delete(id);
    },
    async check() {
      return { episodeServers: ["one", "two"] };
    },
  };
}

test("local imports persist, hide scripts, and survive enable/disable/remove across restart", async () => {
  const driver = new NodeDriver(join(scratch, "restart"));
  const host = runtime();
  const manager = new SourceManager(driver, host);
  await manager.initialize(async () => []);
  await manager.install(row());
  assert.equal(host.active.size, 1);
  const summary = (await manager.list())[0];
  assert.equal(summary.status, "ready");
  assert.equal("source" in summary, false);
  assert.equal("filename" in summary, false);
  await manager.update("fixture", { ...summary, enabled: false });
  assert.equal(host.active.size, 0);
  const restarted = new SourceManager(
    new NodeDriver(join(scratch, "restart")),
    runtime(),
  );
  await restarted.initialize(async () => {
    throw new Error("Legacy config must not be reimported");
  });
  assert.equal((await restarted.list())[0].status, "disabled");
  await restarted.update("fixture", { ...summary, enabled: true });
  await restarted.remove("fixture");
  const removed = new SourceManager(driver, runtime());
  await removed.initialize(async () => [row()]);
  assert.deepEqual(await removed.list(), []);
});

test("one failed source does not prevent other sources loading; check reports invalid servers", async () => {
  const manager = new SourceManager(new MemoryDriver(), runtime());
  await manager.initialize(async () => [row("broken"), row("working")]);
  assert.deepEqual(
    (await manager.list()).map((r) => r.status),
    ["error", "ready"],
  );
  await manager.update("working", {
    ...row("working"),
    preferredServer: "missing",
  });
  await manager.check("working");
  assert.match((await manager.list())[1].error, /not advertised/);
  await manager.update("working", {
    ...row("working"),
    preferredServer: "two",
  });
  await manager.check("working");
  assert.deepEqual((await manager.list())[1].servers, ["one", "two"]);
});

test("invalid hosts, source sizes and duplicate IDs cannot mutate installed sources", async () => {
  const manager = new SourceManager(new MemoryDriver(), runtime());
  await manager.initialize(async () => []);
  for (const host of [
    "https://example.com",
    "*.example.com",
    "127.0.0.1",
    "localhost",
    "example.com/path",
  ]) {
    await assert.rejects(manager.install({ ...row(), hosts: [host] }));
  }
  await assert.rejects(
    manager.install({ ...row(), source: "a".repeat(1048577) }),
  );
  await manager.install(row());
  await assert.rejects(manager.install(row()), /already installed/);
  assert.equal((await manager.list()).length, 1);
});

test("a failed disk write leaves the running and persisted configuration intact", async () => {
  const driver = new MemoryDriver();
  const host = runtime();
  const manager = new SourceManager(driver, host);
  await manager.initialize(async () => [row()]);
  const write = driver.write.bind(driver);
  driver.write = async () => {
    throw new Error("Disk full");
  };
  await assert.rejects(
    manager.update("fixture", { ...row(), enabled: false }),
    /Disk full/,
  );
  assert.equal(host.active.size, 1);
  assert.equal((await manager.list())[0].enabled, true);
  driver.write = write;
  await manager.update("fixture", { ...row(), enabled: false });
  assert.equal(host.active.size, 0);
});

test("C# source lifecycle handles configuration, checks, disable and reload", async () => {
  const client = new CSharpProviderSession(
    join(root, "apps/server/bin/Release/net10.0/Vestra.Server.dll"),
    join(scratch, "worker-state"),
  );
  const runtime = {
    async activate(r) {
      await client.request({
        kind: "load",
        provider: {
          id: r.id,
          source: r.source,
          type: r.type,
          hosts: r.hosts,
          preferences: r.preferences,
        },
      });
    },
    async deactivate(id) {
      client.forget(id);
      await client.request({ kind: "unload", providerId: id });
    },
    check(id) {
      return client.request({
        kind: "call",
        providerId: id,
        method: "getSettings",
        args: [],
      });
    },
  };
  try {
    const manager = new SourceManager(new MemoryDriver(), runtime);
    await manager.initialize(async () => [row()]);
    await manager.check("fixture");
    assert.deepEqual((await manager.list())[0].servers, ["one", "two"]);
    await manager.update("fixture", { ...row(), enabled: false });
    assert.deepEqual(await client.request({ kind: "list" }), []);
    await manager.update("fixture", { ...row(), preferredServer: "two" });
    await manager.check("fixture");
    assert.equal((await manager.list())[0].status, "ready");
    await manager.remove("fixture");
    assert.deepEqual(await client.request({ kind: "list" }), []);
  } finally {
    client.stop();
  }
});

test("disabling a source after worker cancellation prevents replay on restart", async () => {
  const client = new CSharpProviderSession(
    join(root, "apps/server/bin/Release/net10.0/Vestra.Server.dll"),
  );
  const host = {
    async activate(r) {
      await client.request({
        kind: "load",
        provider: { id: r.id, source: r.source, hosts: [] },
      });
    },
    async deactivate(id) {
      client.forget(id);
      await client.request({ kind: "unload", providerId: id });
    },
    check(id) {
      return client.request({
        kind: "call",
        providerId: id,
        method: "getSettings",
        args: [],
      });
    },
  };
  try {
    const manager = new SourceManager(new MemoryDriver(), host);
    await manager.initialize(async () => [
      {
        ...row(),
        source: script.replace(
          "search(){return [];}",
          "async search(){return await new Promise(()=>{});}",
        ),
      },
    ]);
    const controller = new AbortController();
    const pending = client.request(
      {
        kind: "call",
        providerId: "fixture",
        method: "search",
        args: [{ query: "hang" }],
      },
      controller.signal,
    );
    const timer = setTimeout(() => controller.abort(), 150);
    try {
      await assert.rejects(pending, /cancelled/);
    } finally {
      clearTimeout(timer);
    }
    await manager.update("fixture", { ...row(), enabled: false });
    assert.equal((await manager.list())[0].status, "disabled");
    assert.deepEqual(await client.request({ kind: "list" }), []);
  } finally {
    client.stop();
  }
});
