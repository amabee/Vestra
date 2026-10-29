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

test("script replacement preserves settings, identity and its persisted copy", async () => {
  const driver = new NodeDriver(join(scratch, "replace"));
  const host = runtime();
  const manager = new SourceManager(driver, host);
  const original = {
    ...row(),
    preferences: { language: "en" },
    preferredServer: "two",
  };
  await manager.initialize(async () => [original]);
  const before = (await manager.list())[0];
  const replacement = script + "\n// updated";
  await manager.replace(
    "fixture",
    {
      source: replacement,
      filename: "updated.js",
      hosts: ["unwanted.example"],
      preferences: {},
      id: "other",
    },
    before.sourceHash,
  );
  const after = (await manager.list())[0];
  assert.notEqual(after.sourceHash, before.sourceHash);
  assert.equal(after.id, before.id);
  assert.deepEqual(after.hosts, before.hosts);
  assert.deepEqual(after.preferences, before.preferences);
  assert.equal(after.preferredServer, "two");
  assert.equal(host.active.get("fixture").source, replacement);
  const restartedHost = runtime();
  const restarted = new SourceManager(driver, restartedHost);
  await restarted.initialize(async () => []);
  assert.equal(restartedHost.active.get("fixture").source, replacement);
});

test("a failed candidate activation restores the old registration and disk copy", async () => {
  const driver = new MemoryDriver();
  const host = runtime();
  const activate = host.activate.bind(host);
  host.activate = async (entry) => {
    await activate(entry);
    if (entry.source === "broken") throw new Error("Guest syntax failed");
  };
  const manager = new SourceManager(driver, host);
  await manager.initialize(async () => [row()]);
  const before = (await manager.list())[0];
  await assert.rejects(
    manager.replace(
      "fixture",
      { source: "broken", filename: "broken.js" },
      before.sourceHash,
    ),
    /previous script was restored/,
  );
  assert.equal(host.active.get("fixture").source, script);
  assert.equal((await manager.list())[0].sourceHash, before.sourceHash);
  assert.equal((await driver.read("csharp-managed-sources"))[0].source, script);
});

test("replacement write failures restore the running script without changing saved state", async () => {
  const driver = new MemoryDriver();
  const host = runtime();
  const manager = new SourceManager(driver, host);
  await manager.initialize(async () => [row()]);
  const before = (await manager.list())[0];
  driver.write = async () => {
    throw new Error("Disk full");
  };
  await assert.rejects(
    manager.replace(
      "fixture",
      { source: script + "\n// new", filename: "new.js" },
      before.sourceHash,
    ),
    /Disk full/,
  );
  assert.equal(host.active.get("fixture").source, script);
  assert.equal((await driver.read("csharp-managed-sources"))[0].source, script);
});

test("disabled replacement never executes and stale reviews cannot replace newer code", async () => {
  const host = runtime();
  const manager = new SourceManager(new MemoryDriver(), host);
  await manager.initialize(async () => [{ ...row(), enabled: false }]);
  const before = (await manager.list())[0];
  await manager.replace(
    "fixture",
    { source: "not executed", filename: "new.js" },
    before.sourceHash,
  );
  assert.equal(host.active.size, 0);
  assert.equal((await manager.list())[0].status, "disabled");
  await assert.rejects(
    manager.replace(
      "fixture",
      { source: script, filename: "other.js" },
      before.sourceHash,
    ),
    /source changed/,
  );
  assert.equal(host.active.size, 0);
});

test("failed restoration stays visible while the previous source remains saved", async () => {
  const driver = new MemoryDriver();
  const host = runtime();
  const manager = new SourceManager(driver, host);
  await manager.initialize(async () => [row()]);
  const hash = (await manager.list())[0].sourceHash;
  host.activate = async () => {
    throw new Error("Worker unavailable");
  };
  await assert.rejects(
    manager.replace(
      "fixture",
      { source: script + "\n// new", filename: "new.js" },
      hash,
    ),
    /could not be restarted/,
  );
  assert.equal((await manager.list())[0].status, "error");
  assert.equal((await driver.read("csharp-managed-sources"))[0].source, script);
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
    const originalHash = (await manager.list())[0].sourceHash;
    await assert.rejects(
      manager.replace(
        "fixture",
        { source: "class Provider {}", filename: "broken.js" },
        originalHash,
      ),
      /previous script was restored/,
    );
    assert.deepEqual((await runtime.check("fixture")).episodeServers, [
      "one",
      "two",
    ]);
    await assert.rejects(
      manager.replace(
        "fixture",
        {
          source: script.replace("'one','two'", "'other'"),
          filename: "wrong-server.js",
        },
        originalHash,
      ),
      /not advertised/,
    );
    await manager.replace(
      "fixture",
      {
        source: script.replace("'one','two'", "'one','two','three'"),
        filename: "updated.js",
      },
      originalHash,
    );
    assert.deepEqual((await runtime.check("fixture")).episodeServers, [
      "one",
      "two",
      "three",
    ]);
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
