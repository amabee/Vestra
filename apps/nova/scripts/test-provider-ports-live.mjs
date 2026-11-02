import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadNativeSource, sourceRoot } from "./native-source-live-runtime.mjs";
if (!process.argv.includes("--live")) {
  console.log("Use --live for current provider API diagnostics.");
  process.exit(0);
}
const report = { checkedAt: new Date().toISOString(), checks: [{source:"streamflix",api:"held",nativePlayback:"unavailable",message:"Not loaded: movie mirrors fail live checks and large-catalogue teardown needs repair."}] };
for (const name of ["vidlink"]) {
  const runtime = await loadNativeSource(name);
  try {
    if (name === "streamflix") {
      const page = await runtime.source.browse("popular", {
        kind: "movie",
        page: 1,
        limit: 14,
      });
      if (!page.items.length)
        throw Error("Source returned no movie candidates.");
      const episodes = await runtime.source.getEpisodes(page.items[0].id);
      const streams = await runtime.source.getStreams(episodes[0].id);
      report.checks.push({
        source: name,
        api: "responded",
        movieCandidates: page.items.length,
        mirrors: streams.length,
        nativePlayback:
          "unverified; generated URLs do not establish playable media",
      });
    } else {
      const streams = await runtime.source.getStreams("movie|278|s0|e0");
      report.checks.push({
        source: name,
        api: "responded",
        mirrors: streams.length,
        nativePlayback: "unverified",
      });
    }
  } catch (error) {
    report.checks.push({
      source: name,
      api: "blocked",
      message: error.message,
      nativePlayback: "unverified",
    });
  } finally {
    await runtime.dispose();
  }
}
const folder = join(sourceRoot, ".tools/provider-review");
await mkdir(folder, { recursive: true });
await writeFile(
  join(folder, "native-ports-live-report.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
if (report.checks.some((check) => check.api === "blocked"))
  process.exitCode = 2;
