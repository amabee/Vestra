import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadNativeSource, sourceRoot } from "./native-source-live-runtime.mjs";
import { probeMpv } from "./native-media-probe.mjs";
if (!process.argv.includes("--live")) {
  console.log("Use --live for public Internet Archive API checks.");
  process.exit(0);
}
const runtime = await loadNativeSource("internet-archive");
try {
  const found = await runtime.source.search("His Girl Friday", {
    kind: "movie",
    limit: 5,
  });
  assert.ok(found.some((row) => row.id === "his_girl_friday"));
  const first = await runtime.source.browse("popular", {
    kind: "movie",
    page: 1,
    limit: 14,
  });
  const second = await runtime.source.browse("popular", {
    kind: "movie",
    page: 2,
    limit: 14,
  });
  assert.ok(first.items.length > 0 && first.items.length <= 14);
  assert.ok(second.items.length > 0 && second.items.length <= 14);
  const latest = await runtime.source.browse("latest", {
    kind: "movie",
    page: 1,
    limit: 7,
  });
  assert.ok(latest.items.length > 0 && latest.items.length <= 7);
  const episodes = await runtime.source.getEpisodes("his_girl_friday");
  assert.equal(episodes.length, 1);
  const streams = await runtime.source.getStreams(episodes[0].id);
  const video = streams[0].videoSources[0];
  assert.equal(video.type, "mp4");
  const playback = process.argv.includes("--mpv")
    ? await probeMpv(video)
    : null;
  if (playback && video.subtitles?.length)
    assert.ok(playback.subtitleTracks > 0);
  const report = {
    checkedAt: new Date().toISOString(),
    title: "His Girl Friday (1940)",
    searchMatches: found.length,
    popularPage1: first.items.length,
    popularPage2: second.items.length,
    latest: latest.items.length,
    reportedQualities: streams[0].videoSources.map((row) => row.quality),
    captions: video.subtitles?.length ?? 0,
    nativePlayback: playback,
  };
  await mkdir(join(sourceRoot, ".tools/archive-source"), { recursive: true });
  await writeFile(
    join(sourceRoot, ".tools/archive-source/live-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log("PASS " + JSON.stringify(report));
} finally {
  await runtime.dispose();
}
