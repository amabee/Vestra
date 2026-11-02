import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadNativeSource, sourceRoot } from "./native-source-live-runtime.mjs";
import { probeMpv } from "./native-media-probe.mjs";
if (!process.argv.includes("--live")) {
  console.log(
    "Use --live to verify DesiFlix public APIs; --mpv also decodes movie and TV media.",
  );
  process.exit(0);
}
const runtime = await loadNativeSource("desiflix");
const report = { checkedAt: new Date().toISOString(), checks: [] };
try {
  const search = await runtime.source.search("Shawshank", {
    kind: "movie",
    limit: 5,
  });
  assert(search.some((row) => row.id === "movie|tt0111161"));
  for (const id of ["movie|tt0111161", "tv|tt0903747"]) {
    const episodes = await runtime.source.getEpisodes(id);
    assert(episodes.length > 0);
    const selected = id.startsWith("tv|")
      ? episodes.find((row) => row.season === 1 && row.number === 1)
      : episodes[0];
    assert(selected);
    const streams = await runtime.source.getStreams(selected.id);
    assert(streams.length > 0);
    const video = streams[0].videoSources[0];
    assert.equal(video.type, "mkv");
    const playback = process.argv.includes("--mpv")
      ? await probeMpv(video)
      : null;
    report.checks.push({
      title: id,
      episodes: episodes.length,
      mirrors: streams.length,
      reportedQuality: video.quality,
      nativePlayback: playback,
    });
  }
  const folder = join(sourceRoot, ".tools/provider-review");
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, "desiflix-live-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log("PASS " + JSON.stringify(report));
} finally {
  await runtime.dispose();
}
