import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadNativeSource, sourceRoot } from "./native-source-live-runtime.mjs";
if (!process.argv.includes("--live")) {
  console.log("This check contacts KissKH. Run with --live to opt in.");
  process.exit(0);
}
const runtime = await loadNativeSource("kisskh");
const { source, manifest, safeFetch } = runtime;
const report = {
  checkedAt: new Date().toISOString(),
  extension: manifest.id,
  version: manifest.version,
  checks: [],
  scope:
    "Source discovery, search, actual isolate/broker resolution and bounded media/subtitle bytes. No installation or sustained playback.",
};
try {
  for (const kind of ["movie", "tv"])
    for (const category of manifest.discovery.categories) {
      const page = await source.browse(category, { kind, page: 1, limit: 24 });
      assert(page.items.every((row) => row.kind === kind));
      if (category === "popular" || category === "latest")
        assert(page.items.length > 0);
      report.checks.push({
        kind,
        category,
        items: page.items.length,
        hasMore: page.hasMore,
      });
    }
  for (const [kind, query, id] of [
    ["tv", "Goblin", "26"],
    ["movie", "Train to Busan", "56"],
  ]) {
    const started = performance.now();
    const titles = await source.search(query, { kind, limit: 30 });
    const title = titles.find((row) => row.id === `${kind}|${id}`);
    assert(title, `Missing verification title: ${query}`);
    const episodes = await source.getEpisodes(title.id);
    assert(episodes.length > 0);
    const entry = episodes.find((row) => row.number === 1) ?? episodes[0];
    const results = await source.getStreams(entry.id);
    const video = results[0]?.videoSources[0];
    assert(video, "No direct video returned");
    const resolutionMs = Math.round(performance.now() - started);
    const sampleStarted = performance.now();
    const sample = await safeFetch({
      url: video.url,
      method: "GET",
      body: null,
      headers: { ...video.headers, Range: "bytes=0-4095" },
      maxBytes: 8192,
      timeoutMs: 15000,
    });
    assert(sample.status === 206 || sample.status === 200);
    const isMp4 = sample.body.slice(0, 32).includes("ftyp"),
      isHls = sample.body.trimStart().startsWith("#EXTM3U");
    assert(isMp4 || isHls, "Expected MP4 or HLS media signature");
    assert.equal(
      video.type,
      isHls ? "hls" : "mp4",
      "Source type must match actual media, regardless of its URL suffix",
    );
    const sampleMs = Math.round(performance.now() - sampleStarted);
    const caption =
      video.subtitles?.find((row) => row.isDefault) ?? video.subtitles?.[0];
    let captionVerified = false;
    if (caption) {
      const response = await safeFetch({
        url: caption.url,
        method: "GET",
        body: null,
        headers: {},
        maxBytes: 2 * 1024 * 1024,
        timeoutMs: 15000,
      });
      assert.equal(response.status, 200);
      assert(/(?:WEBVTT|\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->)/.test(response.body));
      captionVerified = true;
    }
    const check = {
      kind,
      title: title.title,
      searchResults: titles.length,
      episodes: episodes.length,
      quality: video.quality,
      media: isMp4 ? "mp4" : "hls",
      mediaHost: new URL(video.url).hostname,
      subtitleHost: caption ? new URL(caption.url).hostname : null,
      subtitleTracks: video.subtitles?.length ?? 0,
      captionVerified,
      resolutionMs,
      sampleBytes: Number(sample.headers["content-length"]) || null,
      sampleMs,
    };
    report.checks.push(check);
    console.log("PASS " + JSON.stringify(check));
  }
  await mkdir(join(sourceRoot, ".tools"), { recursive: true });
  await writeFile(
    join(sourceRoot, ".tools/kisskh-live-report.json"),
    JSON.stringify(report, null, 2),
  );
} finally {
  await runtime.dispose();
}
