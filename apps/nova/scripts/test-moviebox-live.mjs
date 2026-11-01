import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.argv.includes("--live")) {
  console.log("This check contacts MovieBox. Run with --live to opt in.");
  process.exit(0);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(
  join(root, "apps/nova/node_modules/.moviebox-live-"),
);
const hostRequire = createRequire(
  join(root, "packages/extension-host/package.json"),
);
try {
  await build({
    stdin: {
      contents: `export {createQuickJSRuntime} from './packages/extension-host/src/runtime/quickjs';export {createStreamSourceProvider} from './packages/extension-host/src/provider';export {createBrokeredFetch} from './packages/extension-host/src/net';export {parseManifest} from './packages/extension-host/src/manifest';export {safeFetch} from './apps/nova/electron/safe-fetch';`,
      resolveDir: root,
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(scratch, "runtime.cjs"),
    plugins: [
      {
        name: "real-quickjs",
        setup(build) {
          build.onResolve({ filter: /^quickjs-emscripten$/ }, () => ({
            path: hostRequire.resolve("quickjs-emscripten"),
            external: true,
          }));
        },
      },
    ],
  });
  const {
    createQuickJSRuntime,
    createStreamSourceProvider,
    createBrokeredFetch,
    parseManifest,
    safeFetch,
  } = createRequire(import.meta.url)(join(scratch, "runtime.cjs"));
  const parsed = parseManifest(
    JSON.parse(
      await readFile(join(root, "extensions/moviebox/manifest.json"), "utf8"),
    ),
  );
  assert.deepEqual(parsed.errors, []);
  const manifest = parsed.manifest;
  const fetcher = createBrokeredFetch(
    {
      extensionId: manifest.id,
      granted: manifest.permissions,
      allowedHosts: manifest.hosts,
      grantedForVersion: manifest.version,
      grantedAt: new Date().toISOString(),
    },
    { request: safeFetch },
  );
  const loaded = await createQuickJSRuntime().load({
    extensionId: manifest.id,
    source: await readFile(join(root, "extensions/moviebox/index.js"), "utf8"),
    bridge: { extensionId: manifest.id, fetch: fetcher, log() {} },
  });
  const report = {
    checkedAt: new Date().toISOString(),
    extension: manifest.id,
    version: manifest.version,
    checks: [],
    scope:
      "Public guest session, catalogue/episodes/streams and bounded video bytes; no app installation or sustained playback.",
  };
  try {
    const source = createStreamSourceProvider({
      extensionId: manifest.id,
      name: manifest.name,
      kinds: manifest.kinds,
      browseCategories: manifest.discovery.categories,
      methods: await loaded.listMethods(AbortSignal.timeout(10000)),
      call: (method, args, signal) => loaded.call(method, [...args], signal),
    });
    for (const kind of ["movie", "tv"])
      for (const category of ["popular", "latest"]) {
        const page = await source.browse(category, {
          kind,
          page: 1,
          limit: 24,
        });
        assert(page.items.length > 0, `No ${kind} collection titles`);
        assert(page.items.every((row) => row.kind === kind));
        report.checks.push({
          kind,
          category,
          collectionItems: page.items.length,
          hasMore: page.hasMore,
        });
      }
    for (const [kind, query] of [
      ["tv", "Sherlock"],
      ["movie", "Night of the Living Dead"],
    ]) {
      const started = performance.now();
      const titles = await source.search(query, { kind, limit: 30 });
      assert(titles.length > 0, `No ${kind} search results`);
      const title =
        kind === "tv"
          ? titles.find((row) => row.id.includes("8666712202625310728"))
          : titles.find((row) => row.year === 1968);
      assert(title, `Expected verification title missing: ${query}`);
      const episodes = await source.getEpisodes(title.id);
      assert(episodes.length > 0);
      const entry =
        kind === "tv"
          ? episodes.find((row) => row.season === 4 && row.number === 1)
          : episodes[0];
      assert(entry, "Expected verification entry missing");
      const results = await source.getStreams(entry.id);
      const variants = results.flatMap((row) => row.videoSources);
      assert(variants.length > 0);
      const resolutionMs = Math.round(performance.now() - started);
      const best = [...variants].sort(
        (a, b) => parseInt(b.quality) - parseInt(a.quality),
      )[0];
      const bytesStarted = performance.now();
      const sample = await safeFetch({
        url: best.url,
        method: "GET",
        body: null,
        headers: { ...best.headers, Range: "bytes=0-4095" },
        maxBytes: 8192,
        timeoutMs: 15000,
      });
      assert.equal(
        sample.status,
        206,
        "Expected bounded partial video content",
      );
      assert(
        sample.body.slice(0, 32).includes("ftyp"),
        "Expected an MP4 container signature",
      );
      const check = {
        kind,
        title: title.title,
        searchResults: titles.length,
        episodes: episodes.length,
        qualities: variants.map((row) => row.quality),
        subtitleTracks: best.subtitles?.length ?? 0,
        resolutionMs,
        sampleBytes: Number(sample.headers["content-length"]) || null,
        sampleMs: Math.round(performance.now() - bytesStarted),
      };
      report.checks.push(check);
      console.log("PASS " + JSON.stringify(check));
    }
    await mkdir(join(root, ".tools"), { recursive: true });
    await writeFile(
      join(root, ".tools/moviebox-live-report.json"),
      JSON.stringify(report, null, 2),
    );
  } finally {
    loaded.dispose();
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
