import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(
  join(root, "apps/nova/node_modules/.extension-updates-"),
);
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  stdin: {
    contents: `export {FOUNDRY_REGISTRY_URL} from './packages/types/src/index';export {ExtensionUpdater,serializeExtensionChange} from './apps/nova/electron/extension-updates';export {MemoryDriver} from './packages/storage/src/index';export {prepareInstall,completeInstall} from './packages/extension-host/src/install';export {getInstalled,saveInstalled,readSource,setInstalledEnabled} from './packages/extension-host/src/store';export {parseRegistry,extensionSupport} from './packages/provider-sdk/src/marketplace';`,
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "test.cjs"),
});
const {
  FOUNDRY_REGISTRY_URL,
  ExtensionUpdater,
  serializeExtensionChange,
  MemoryDriver,
  prepareInstall,
  completeInstall,
  getInstalled,
  saveInstalled,
  readSource,
  setInstalledEnabled,
  parseRegistry,
  extensionSupport,
} = createRequire(import.meta.url)(join(scratch, "test.cjs"));
async function fixture(options = {}) {
  const driver = new MemoryDriver(),
    files = new Map(),
    calls = [],
    active = [];
  const candidate = {
    id: "fixture",
    name: "Fixture",
    version: "1.0.0",
    type: "custom-source",
    registryUrl: "https://registry.example/index.json",
    manifestURI: "https://registry.example/manifest.json",
    payloadURI: "",
  };
  function version(value, code = "// " + value, extra = {}) {
    files.set(
      candidate.registryUrl,
      JSON.stringify([{ ...candidate, version: value }]),
    );
    files.set(
      candidate.manifestURI,
      JSON.stringify({
        id: "fixture",
        name: "Fixture",
        version: value,
        sdkVersion: "1.0.0",
        main: "index.js",
        permissions: ["network"],
        hosts: ["old.example"],
        kinds: ["movie"],
        ...extra,
      }),
    );
    files.set("https://registry.example/index.js", code);
  }
  const transport = {
    request: async (request) => {
      calls.push(request.url);
      if (!files.has(request.url)) throw Error("Missing fixture");
      return { status: 200, headers: {}, body: files.get(request.url) };
    },
  };
  version("1.0.0");
  const installed = await completeInstall(
    await prepareInstall(candidate, transport),
    ["network"],
    transport,
  );
  await saveInstalled(
    driver,
    { ...installed.record, ...options },
    installed.source,
  );
  let now = 1000,
    fail = false;
  const updater = new ExtensionUpdater(
    driver,
    transport,
    async (record, source) => {
      active.push({ record, source });
      if (fail && record.version === "2.0.0")
        throw Error("Invalid runtime methods");
    },
    () => null,
    () => now,
  );
  return {
    driver,
    transport,
    files,
    calls,
    active,
    updater,
    version,
    expire: () => {
      now += 600001;
    },
    fail: () => {
      fail = true;
    },
  };
}
test("registry arrays, wrapped arrays and individual inline manifests list without exposing executable payloads", () => {
  const manifest = {
    id: "fixture",
    name: "Fixture",
    version: "1.0.0",
    language: "javascript",
    type: "manga-provider",
    payload: "class Provider {}",
  };
  for (const doc of [
    [manifest],
    { extensions: [manifest] },
    { entries: [manifest] },
    manifest,
  ]) {
    const result = parseRegistry(doc, "https://registry.example/source.json");
    assert.equal(result.entries.length, 1);
    assert.equal(result.rejected, 0);
    assert.equal(Object.hasOwn(result.entries[0], "payload"), false);
    assert.equal(extensionSupport(result.entries[0]).supported, true);
  }
  assert.equal(
    parseRegistry(manifest, "https://registry.example/source.json").entries[0]
      .manifestURI,
    "https://registry.example/source.json",
  );
  assert.equal(parseRegistry({ wat: [] }).rejected, 1);
  assert.equal(
    parseRegistry(
      {
        id: "catalogue",
        name: "Catalogue",
        extensions: [
          {
            ...manifest,
            manifestURI: "https://registry.example/manifest.json",
          },
        ],
      },
      "https://registry.example/index.json",
    ).entries[0].manifestURI,
    "https://registry.example/manifest.json",
  );
  for (const change of [
    { type: "future-type" },
    { language: "go" },
    { type: "plugin" },
  ]) {
    const result = parseRegistry({ ...manifest, ...change });
    assert.equal(result.entries.length, 1);
    assert.equal(extensionSupport(result.entries[0]).supported, false);
  }
  assert.equal(extensionSupport({ type: "constructor" }).supported, false);
});

test("bundled updates require the exact shipped path and direct installs keep their origin", async () => {
  const f = await fixture();
  f.version("2.0.0");
  const record = await getInstalled(f.driver, "fixture");
  await saveInstalled(
    f.driver,
    { ...record, registryUrl: "direct:manifest" },
    "// 1.0.0",
  );
  assert.equal((await f.updater.prepare("fixture")).version, "2.0.0");
  const shipped = join(scratch, "shipped", "manifest.json");
  const updater = new ExtensionUpdater(
    f.driver,
    f.transport,
    async () => {},
    () => shipped,
  );
  await saveInstalled(
    f.driver,
    {
      ...record,
      registryUrl: "local:unpacked",
      manifestURI: join(scratch, "user", "manifest.json"),
    },
    "// 1.0.0",
  );
  await assert.rejects(updater.prepare("fixture"), /local extension/);
  await saveInstalled(
    f.driver,
    { ...record, registryUrl: "local:unpacked", manifestURI: shipped },
    "// 1.0.0",
  );
  f.files.set(
    FOUNDRY_REGISTRY_URL,
    f.files.get("https://registry.example/index.json"),
  );
  const review = await updater.prepare("fixture");
  assert.equal(review.plan.candidate.registryUrl, FOUNDRY_REGISTRY_URL);
  assert.equal(review.version, "2.0.0");
});
test("checking is read-only; review pins bytes and requires explicit new permission consent", async () => {
  const f = await fixture();
  f.version("2.0.0", "// reviewed", {
    permissions: ["network", "library:read"],
    hosts: ["old.example", "new.example"],
  });
  const summary = await f.updater.checkAll();
  assert.equal(summary[0].status, "available");
  assert.equal(f.active.length, 0);
  assert.equal((await getInstalled(f.driver, "fixture")).version, "1.0.0");
  const review = await f.updater.prepare("fixture");
  assert.deepEqual(review.addedPermissions, ["library:read"]);
  assert.deepEqual(review.addedHosts, ["new.example"]);
  assert.deepEqual(review.retainedPermissions, ["network"]);
  const old = await getInstalled(f.driver, "fixture");
  f.version("3.0.0", "// changed after review");
  const record = await f.updater.apply(
    review.token,
    review.retainedPermissions,
  );
  assert.equal(record.version, "2.0.0");
  assert.equal(record.installedAt, old.installedAt);
  assert.deepEqual(record.grant.granted, ["network"]);
  assert.equal(await readSource(f.driver, record), "// reviewed");
  assert.equal(f.active[0].source, "// reviewed");
  await assert.rejects(f.updater.apply(review.token, []), /expired/);
});
test("same-version code changes are reviewable and disabled installs stay disabled", async () => {
  const f = await fixture({ enabled: false });
  f.version("1.0.0", "// changed");
  const review = await f.updater.prepare("fixture");
  assert.equal(review.changed, true);
  assert.ok(review.plan.warnings.some((x) => x.includes("without a version")));
  const record = await f.updater.apply(review.token, []);
  assert.equal(record.enabled, false);
  assert.equal(f.active[0].record.enabled, false);
  assert.deepEqual(record.grant.allowedHosts, []);
  assert.equal((await f.updater.checkAll())[0].status, "current");
});
test("failed activation restores previous code and keeps installed metadata", async () => {
  const f = await fixture();
  f.version("2.0.0");
  f.fail();
  const review = await f.updater.prepare("fixture");
  await assert.rejects(
    f.updater.apply(review.token, ["network"]),
    /previous version was restored/,
  );
  const record = await getInstalled(f.driver, "fixture");
  assert.equal(record.version, "1.0.0");
  assert.equal(await readSource(f.driver, record), "// 1.0.0");
  assert.equal(f.active.at(-1).record.version, "1.0.0");
});
test("failed persistence restores previous runtime and installed metadata", async () => {
  const f = await fixture();
  f.version("2.0.0");
  const review = await f.updater.prepare("fixture"),
    write = f.driver.write.bind(f.driver);
  f.driver.write = async (key, value) => {
    if (key === "extensions") throw Error("Disk full");
    return write(key, value);
  };
  await assert.rejects(
    f.updater.apply(review.token, []),
    /previous version was restored/,
  );
  assert.equal((await getInstalled(f.driver, "fixture")).version, "1.0.0");
  assert.equal(f.active.at(-1).record.version, "1.0.0");
});
test("stale, expired and over-granted reviews are refused before activation", async () => {
  const f = await fixture();
  f.version("2.0.0");
  let review = await f.updater.prepare("fixture");
  await serializeExtensionChange(() =>
    setInstalledEnabled(f.driver, "fixture", false),
  );
  await assert.rejects(
    f.updater.apply(review.token, []),
    /changed after review/,
  );
  review = await f.updater.prepare("fixture");
  f.expire();
  await assert.rejects(f.updater.apply(review.token, []), /expired/);
  review = await f.updater.prepare("fixture");
  await assert.rejects(
    f.updater.apply(review.token, ["progress:read"]),
    /unrequested/,
  );
  assert.equal(f.active.length, 0);
});
test("identity, role, missing origin and duplicate listings never activate code", async () => {
  const f = await fixture();
  f.version("2.0.0", "// two", { id: "substituted" });
  await assert.rejects(f.updater.prepare("fixture"), /identif|does not match/i);
  f.version("2.0.0", "// two", { role: "stream-source", kinds: ["anime"] });
  await assert.rejects(f.updater.prepare("fixture"), /runtime role/);
  f.version("2.0.0");
  const registry = "https://registry.example/index.json";
  f.files.set(
    registry,
    JSON.stringify([
      ...JSON.parse(f.files.get(registry)),
      ...JSON.parse(f.files.get(registry)),
    ]),
  );
  await assert.rejects(f.updater.prepare("fixture"), /exactly one/);
  const record = await getInstalled(f.driver, "fixture");
  await saveInstalled(
    f.driver,
    {
      ...record,
      registryUrl: "local:unpacked",
      manifestURI: join(scratch, "manifest.json"),
    },
    "// 1.0.0",
  );
  assert.equal((await f.updater.checkAll())[0].status, "local");
  assert.equal(f.active.length, 0);
});
