import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { loadNativeSource, sourceRoot } from "./native-source-live-runtime.mjs";
import { join } from "node:path";
import { probeMpv } from "./native-media-probe.mjs";

if (!process.argv.includes("--live")) {
  console.log("Use --live to check VixSrc public delivery.");
  process.exit(0);
}
const runtime = await loadNativeSource("vixsrc");
const report = {
  checkedAt: new Date().toISOString(),
  scope: "native extraction, bounded HLS media samples and subtitle text",
  checks: [],
};
try {
  for (const test of [
    { kind: "movie", id: "278", name: "The Shawshank Redemption" },
    {
      kind: "tv",
      id: "1396",
      season: 1,
      episode: 1,
      name: "Breaking Bad S1E1",
    },
    {
      kind: "tv",
      id: "1396",
      season: 5,
      episode: 1,
      name: "Breaking Bad S5E1",
    },
  ]) {
    const started = performance.now();
    const titleId = `${test.kind}|${test.id}`;
    const match = await runtime.source.search(test.id, { kind: test.kind });
    assert.equal(match[0]?.id, titleId);
    const hints =
      test.kind === "tv"
        ? [
            {
              id: `${titleId}|s${test.season}|e${test.episode}`,
              animeId: titleId,
              season: test.season,
              number: test.episode,
              title: test.name,
            },
          ]
        : [];
    const episodes = await runtime.call("getEpisodes", [titleId, hints]);
    assert.equal(episodes.length, 1);
    const result = await runtime.source.getStreams(episodes[0].id);
    const video = result[0]?.videoSources[0];
    assert.equal(video?.type, "hls");
    const resolutionMs = Math.round(performance.now() - started);
    const nativePlayback = process.argv.includes("--mpv")
      ? await probeMpv(video)
      : null;
    const get = async (url, maxBytes = 512000, extra = {}) =>
      runtime.safeFetch({
        url,
        method: "GET",
        body: null,
        headers: { ...video.headers, ...extra },
        timeoutMs: 15000,
        maxBytes,
      });
    const master = await get(video.url);
    assert.equal(master.status, 200);
    assert.ok(master.body.startsWith("#EXTM3U"));
    const lines = master.body.split(/\r?\n/);
    const variant = lines.findIndex((line) =>
      line.startsWith("#EXT-X-STREAM-INF:"),
    );
    assert.ok(variant >= 0);
    const variantUrl = new URL(lines[variant + 1], video.url).href;
    const media = await get(variantUrl);
    assert.equal(media.status, 200);
    assert.ok(media.body.includes("#EXTINF:"));
    const segment = media.body
      .split(/\r?\n/)
      .find((line) => line.trim() && !line.startsWith("#"));
    assert.ok(segment);
    const segmentUrl = new URL(segment, variantUrl).href;
    const sample = await get(segmentUrl, 8192, { Range: "bytes=0-4095" });
    assert.ok([200, 206].includes(sample.status));
    assert.ok(sample.body.length > 0);
    const captions = lines.filter(
      (line) =>
        line.startsWith("#EXT-X-MEDIA:") && line.includes("TYPE=SUBTITLES"),
    );
    let captionVerified = false;
    const english = captions.find((line) => line.includes('LANGUAGE="eng"'));
    if (english) {
      const url = /URI="([^"]+)"/.exec(english)?.[1];
      if (url) {
        const playlist = await get(new URL(url, video.url).href);
        const file = playlist.body
          .split(/\r?\n/)
          .find((line) => line.trim() && !line.startsWith("#"));
        if (file) {
          const caption = await get(new URL(file, url).href, 2 * 1024 * 1024);
          captionVerified =
            caption.status === 200 &&
            caption.body.trimStart().startsWith("WEBVTT");
        }
      }
    }
    const check = {
      title: test.name,
      kind: test.kind,
      season: test.season ?? null,
      episode: test.episode ?? null,
      resolutionMs,
      resolutions: [...master.body.matchAll(/RESOLUTION=([^,\r\n]+)/g)].map(
        (match) => match[1],
      ),
      audioTracks: lines.filter((line) => line.includes("TYPE=AUDIO")).length,
      subtitleTracks: captions.length,
      captionVerified,
      mediaHost: new URL(segmentUrl).hostname,
      sampleBytes:
        Number(sample.headers["content-length"]) || sample.body.length,
      nativePlayback,
    };
    report.checks.push(check);
    console.log("PASS " + JSON.stringify(check));
  }
  await assert.rejects(
    () => runtime.source.getStreams("tv|1396|s99|e99"),
    /unavailable|resolve|404/i,
  );
  console.log("PASS unavailable episode returns a source error");
  await mkdir(join(sourceRoot, ".tools"), { recursive: true });
  await writeFile(
    join(sourceRoot, ".tools/vixsrc-live-report.json"),
    JSON.stringify(report, null, 2),
  );
} finally {
  await runtime.dispose();
}
