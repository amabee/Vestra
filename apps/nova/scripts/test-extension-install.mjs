import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(
  join(root, "apps/nova/node_modules/.extension-install-"),
);
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  stdin: {
    contents: `export {prepareExtensionReview} from './apps/nova/electron/extension-install'; export {RemoteSourceService} from './apps/nova/electron/source-remote';export {SourceManager} from './apps/nova/electron/source-manager';export {MemoryDriver} from './packages/storage/src/index';export {CSharpProviderWorker} from './apps/nova/electron/csharp-worker';export {transpileProvider} from './apps/nova/electron/provider-transpile';export {safeFetch} from './apps/nova/electron/safe-fetch';`,
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "install.cjs"),
});
const {
  prepareExtensionReview,
  RemoteSourceService,
  SourceManager,
  MemoryDriver,
  CSharpProviderWorker,
  transpileProvider,
  safeFetch,
} = createRequire(import.meta.url)(join(scratch, "install.cjs"));
const candidate = {
  id: "fixture",
  name: "Fixture",
  version: "1.0.0",
  type: "onlinestream-provider",
  manifestURI: "https://registry.example/fixture/manifest.json",
  payloadURI: "",
  registryUrl: "https://registry.example/index.json",
};
function transport(document) {
  const calls = [];
  return {
    calls,
    request: async (request) => {
      calls.push(request.url);
      return { status: 200, headers: {}, body: JSON.stringify(document) };
    },
  };
}
test("SDK listings without code URLs resolve manifest payloadURI or relative main before review", async () => {
  const manifest = {
    id: "fixture",
    name: "Fixture",
    version: "1.0.0",
    sdkVersion: "1.0.0",
    main: "index.js",
    permissions: [],
    kinds: ["anime"],
    role: "stream-source",
  };
  const t = transport(manifest);
  const result = await prepareExtensionReview(candidate, t, () =>
    assert.fail("SDK dispatched to C#"),
  );
  assert.equal(result.kind, "sdk");
  assert.equal(
    result.plan.candidate.payloadURI,
    "https://registry.example/fixture/index.js",
  );
  assert.equal(t.calls.length, 1);
  const explicit = await prepareExtensionReview(
    candidate,
    transport({ ...manifest, payloadURI: "https://cdn.example/script.js" }),
    () => assert.fail(),
  );
  assert.equal(
    explicit.plan.candidate.payloadURI,
    "https://cdn.example/script.js",
  );
});
test("Seanime manifest-only listings use the existing staged provider installer and reviewed host grants", async () => {
  const driver = new MemoryDriver(),
    active = new Map();
  const manager = new SourceManager(driver, {
    activate: async (row) => active.set(row.id, row),
    deactivate: async (id) => active.delete(id),
    check: async () => ({ episodeServers: ["One"] }),
  });
  await manager.initialize(async () => []);
  const manifest = {
    id: "fixture",
    name: "Fixture",
    type: "onlinestream-provider",
    language: "typescript",
    version: "1.0.0",
    payloadURI: "https://cdn.example/provider.ts",
  };
  let downloads = 0;
  const remote = new RemoteSourceService(manager, async (url) => {
    downloads++;
    assert.equal(url, manifest.payloadURI);
    return Buffer.from('class Provider { base="https://anime.example/"; }');
  });
  const review = await prepareExtensionReview(
    candidate,
    transport(manifest),
    (url, document) => remote.prepare(url, undefined, document),
  );
  assert.equal(review.kind, "provider");
  assert.equal(downloads, 1);
  assert.deepEqual(await manager.list(), []);
  assert.equal(active.size, 0);
  assert.deepEqual(review.plan.hosts, ["anime.example"]);
  assert.equal(review.plan.inferredHosts, true);
  await remote.apply(review.plan.token, ["approved.example"]);
  assert.deepEqual(active.get("fixture").hosts, ["approved.example"]);
  assert.equal(active.get("fixture").filename, "provider.ts");
});
test("manifest identity and type substitutions are refused before provider download or installation", async () => {
  await assert.rejects(
    prepareExtensionReview(
      candidate,
      transport({ id: "different", type: "onlinestream-provider" }),
      () => assert.fail(),
    ),
    /identity/,
  );
  await assert.rejects(
    prepareExtensionReview(
      candidate,
      transport({ id: "fixture", type: "manga-provider" }),
      () => assert.fail(),
    ),
    /content type/,
  );
  await assert.rejects(
    prepareExtensionReview(
      { ...candidate, manifestURI: "http://registry.example/manifest" },
      transport({}),
      () => assert.fail(),
    ),
    /HTTPS/,
  );
});
if (process.argv.includes("--live"))
  test("a real Available-list TypeScript provider previews, installs and executes in isolated C# storage", async () => {
    const url =
      "https://raw.githubusercontent.com/Pal-droid/Seanime-Providers/main/src/anime/AnimeAV1/manifest.json";
    const worker = new CSharpProviderWorker(
      join(root, "apps/server/bin/Release/net10.0/Vestra.Server.dll"),
      join(scratch, "provider-store"),
    );
    const driver = new MemoryDriver();
    const manager = new SourceManager(driver, {
      activate: async (row) => {
        await worker.request({
          kind: "load",
          provider: {
            id: row.id,
            type: row.type,
            source: transpileProvider(row.source, row.filename),
            hosts: row.hosts,
            preferences: row.preferences,
          },
        });
        await worker.request({
          kind: "call",
          providerId: row.id,
          method: "getSettings",
          args: [],
        });
      },
      deactivate: async (id) =>
        worker.request({ kind: "unload", providerId: id }),
      check: async () => ({}),
    });
    try {
      await manager.initialize(async () => []);
      const remote = new RemoteSourceService(manager, async (url) =>
        Buffer.from((await safeFetch({ url, maxBytes: 1048576 })).body),
      );
      const review = await prepareExtensionReview(
        { ...candidate, id: "animeav1", name: "AnimeAV1", manifestURI: url },
        { request: safeFetch },
        (url, doc) => remote.prepare(url, undefined, doc),
      );
      assert.equal(review.kind, "provider");
      assert.deepEqual(await manager.list(), []);
      await remote.apply(review.plan.token, review.plan.hosts);
      const [installed] = await manager.list();
      assert.equal(installed.status, "ready", installed.error);
      assert.equal(installed.id, "animeav1");
      console.log(
        "LIVE AnimeAV1",
        JSON.stringify({
          status: installed.status,
          version: installed.remote.version,
          hostsReviewed: installed.hosts.length,
          checksum: installed.sourceHash,
          storage: "isolated test store; user installation unchanged",
        }),
      );
    } finally {
      worker.stop();
    }
  });
