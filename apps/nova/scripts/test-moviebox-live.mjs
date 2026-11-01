import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadNativeSource,
  sourceRoot as root,
} from "./native-source-live-runtime.mjs";
if (!process.argv.includes("--live")) {
  console.log("This check contacts MovieBox. Run with --live to opt in.");
  process.exit(0);
}
const runtime = await loadNativeSource("moviebox");
const { source, manifest, safeFetch } = runtime;
const report = {
  checkedAt: new Date().toISOString(),
  extension: manifest.id,
  version: manifest.version,
  checks: [],
  scope:
    "Public guest session, catalogue/episodes/streams and bounded video bytes; no app installation or sustained playback.",
};
try {
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
    assert.equal(sample.status, 206, "Expected bounded partial video content");
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
  await runtime.dispose();
}
