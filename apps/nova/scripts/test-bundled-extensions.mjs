import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm, cp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(
  join(root, "apps/nova/node_modules/.bundled-extensions-"),
);
try {
  const requireHost = createRequire(
    join(root, "packages/extension-host/package.json"),
  );
  await build({
    stdin: {
      contents: `export * from './apps/nova/electron/bundled-extensions';export {completeUnpacked} from './apps/nova/electron/extension-unpacked';export {createQuickJSRuntime} from './packages/extension-host/src/runtime/quickjs';`,
      resolveDir: root,
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(scratch, "test.cjs"),
    plugins: [
      {
        name: "quickjs",
        setup(b) {
          b.onResolve({ filter: /^quickjs-emscripten$/ }, () => ({
            path: requireHost.resolve("quickjs-emscripten"),
            external: true,
          }));
        },
      },
    ],
  });
  const m = createRequire(import.meta.url)(join(scratch, "test.cjs"));
  const resourceOption = process.argv.indexOf("--resources");
  const sourceRoot =
    resourceOption >= 0
      ? join(resolve(process.argv[resourceOption + 1]), "extensions")
      : join(root, "extensions");
  const catalogue = await m.listBundled(sourceRoot);
  assert.deepEqual(catalogue.errors, []);
  assert.equal(catalogue.entries.length, 49);
  assert.equal(new Set(catalogue.entries.map((e) => e.id)).size, 49);
  assert(
    catalogue.entries.some(
      (e) => e.id === "vestra-vixsrc" && e.kinds.includes("tv"),
    ),
  );
  const anime = catalogue.entries.filter(
    (e) =>
      e.kinds.includes("anime") &&
      ![
        "vestra-moviebox",
        "vestra-kisskh",
        "vestra-internet-archive",
        "vestra-streamflix",
        "vestra-vidlink",
        "vestra-desiflix",
      ].includes(e.id),
  );
  assert.equal(anime.length, 17);
  assert(anime.every((e) => e.type === "onlinestream-provider"));
  assert.equal(
    catalogue.entries.filter((e) => e.type === "manga-provider").length,
    25,
  );
  for (const name of [
    "vidlink",
    "desiflix",
    "animeav1",
    "animeheaven",
    "shiro",
    "mangabuddy",
    "mangadex",
    "weebcentral",
  ]) {
    const e = catalogue.entries.find((e) => e.id === "vestra-" + name);
    assert.equal(e.registryUrl, "vestra:bundled");
    if (name === "vidlink") assert(e.tags.includes("experimental"));
    const plan = await m.prepareBundled(sourceRoot, e.id);
    if (name === "vidlink")
      assert(
        plan.warnings.some((w) =>
          w.includes("upstream live checks currently fail"),
        ),
      );
    const { record, source } = await m.completeUnpacked(plan, plan.requested);
    assert.equal(record.id, e.id);
    assert.equal(record.type, e.type);
    assert.equal(record.registryUrl, "local:unpacked");
    const loaded = await m.createQuickJSRuntime().load({
      extensionId: record.id,
      source,
      bridge: {
        extensionId: record.id,
        log() {},
        fetch: async () => {
          throw Error("Installation must not request network access");
        },
      },
    });
    try {
      const methods = await loaded.listMethods(AbortSignal.timeout(5000));
      for (const method of ["mangabuddy", "mangadex", "weebcentral"].includes(
        name,
      )
        ? ["search", "searchPage", "getChapters", "getPages"]
        : ["search", "getEpisodes", "getStreams"])
        assert(methods.includes(method));
      if (name === "vidlink") assert(methods.includes("matchCatalogue"));
    } finally {
      loaded.dispose();
    }
  }
  assert(
    catalogue.entries
      .find((e) => e.id === "vestra-streamflix")
      .tags.includes("installation-blocked"),
  );
  await assert.rejects(
    () => m.prepareBundled(sourceRoot, "vestra-streamflix"),
    /not ready/,
  );
  await assert.rejects(
    () => m.prepareBundled(sourceRoot, "../../README"),
    /Unknown bundled/,
  );
  await assert.rejects(
    () => m.prepareBundled(sourceRoot, "vestra-unknown"),
    /Unknown bundled/,
  );
  // Exercise the same source paths after copying the release resources.
  const packaged = join(scratch, "resources/extensions");
  await cp(sourceRoot, packaged, { recursive: true });
  assert.equal((await m.listBundled(packaged)).entries.length, 49);
  const manifestPath = join(packaged, "vidlink/manifest.json");
  const bad = JSON.parse(await readFile(manifestPath, "utf8"));
  bad.id = "different";
  await writeFile(manifestPath, JSON.stringify(bad));
  await assert.rejects(
    () => m.prepareBundled(packaged, "vestra-vidlink"),
    /identity mismatch/,
  );
  const partial = await m.listBundled(packaged);
  assert.equal(partial.entries.length, 48);
  assert.equal(partial.errors.length, 1);
  console.log(
    "PASS: 49 bundled listings, offline review/install, sandbox exports, experimental warnings, fixed identities, packaged paths and partial failure",
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
