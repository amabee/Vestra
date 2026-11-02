import { build } from "esbuild";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  copyFile,
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const seconds = Number(option("--seconds", "60"));
const samples = Number(option("--samples", "2"));
if (
  !Number.isInteger(seconds) ||
  seconds < 10 ||
  seconds > 300 ||
  !Number.isInteger(samples) ||
  samples < 1 ||
  samples > 8
)
  throw Error("Use --seconds 10–300 and --samples 1–8.");
const output = resolve(
  option("--output", join(root, ".tools/playback-benchmark/report.json")),
);
const scratch = await mkdtemp(join(tmpdir(), "vestra-live-benchmark-"));
const report = {
  measuredAt: new Date().toISOString(),
  secondsPerSample: seconds,
  mode: "hidden null video/audio output; native cache profile; no mirror recovery",
  results: [],
};
await build({
  stdin: {
    contents: `export {CSharpProviderSession} from './apps/nova/electron/csharp-worker'; export {resolveEpisodeServers} from './apps/nova/electron/episode-servers'; export {probePlayableStream} from './apps/nova/electron/probe-stream'; export {transpileProvider} from './apps/nova/electron/provider-transpile'; export {applyProviderCompatibility} from './apps/nova/electron/provider-compat'; export {extractStreamplay, streamplayEmbed} from './apps/nova/electron/streamplay'; export {MpvConnection} from './apps/nova/electron/mpv/connection'; export {STREAM_CACHE_ARGS, automaticVariant, AUTO_HLS_BITRATE} from './apps/nova/electron/mpv/stream-policy';`,
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "benchmark.cjs"),
});
const api = createRequire(import.meta.url)(join(scratch, "benchmark.cjs"));
// The compiler is host-owned and loaded beside the bundled benchmark, just as in Nova.
const compiler = createRequire(join(root, "apps/nova/package.json")).resolve(
  "typescript",
);
await copyFile(compiler, join(scratch, "provider-typescript.cjs"));

async function playback(stream, profile = { probeInfo: "auto", pauseWait: 1 }) {
  const pipe =
    process.platform === "win32"
      ? `\\\\.\\pipe\\vestra-benchmark-${randomUUID()}`
      : join(scratch, randomUUID());
  const connection = new api.MpvConnection();
  const child = spawn(
    join(root, "apps/nova/vendor/mpv/mpv.exe"),
    [
      "--no-config",
      "--vo=null",
      "--ao=null",
      "--no-audio",
      "--idle=yes",
      "--terminal=no",
      ...api.STREAM_CACHE_ARGS,
      `--demuxer-lavf-probe-info=${profile.probeInfo}`,
      `--cache-pause-wait=${profile.pauseWait}`,
      `--hls-bitrate=${api.AUTO_HLS_BITRATE}`,
      `--input-ipc-server=${pipe}`,
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  let finish;
  let timer;
  let started = 0;
  let ready = 0;
  let restarted = false;
  let params = null;
  let position = 0;
  let firstPosition = null;
  let buffering = false;
  let bufferStart = null;
  let bufferTotal = 0;
  let bufferCount = 0;
  let minBuffer = Infinity;
  const speeds = [];
  const done = new Promise((resolve) => {
    finish = resolve;
  });
  const complete = (outcome) => finish(outcome);
  const markReady = () => {
    if (ready || !restarted || !params?.w || !params?.h) return;
    ready = performance.now();
    firstPosition = position;
    if (buffering) {
      bufferStart = ready;
      bufferCount++;
    }
    clearTimeout(timer);
    timer = setTimeout(() => complete("observed"), seconds * 1000);
  };
  child.on("error", () => complete("process-error"));
  child.on("exit", () => complete("process-exit"));
  try {
    await connection.connect(pipe);
    connection.onEvent((event) => {
      if (event.event === "playback-restart") {
        restarted = true;
        markReady();
      }
      if (event.event === "end-file")
        complete(event.reason === "error" ? "delivery-error" : "end-of-file");
      if (event.event !== "property-change") return;
      if (event.name === "video-params") {
        params = event.data;
        markReady();
      }
      if (event.name === "time-pos" && Number.isFinite(event.data))
        position = event.data;
      if (
        event.name === "cache-speed" &&
        ready &&
        Number.isFinite(event.data) &&
        event.data > 0
      )
        speeds.push(event.data);
      if (
        event.name === "demuxer-cache-duration" &&
        ready &&
        Number.isFinite(event.data)
      )
        minBuffer = Math.min(minBuffer, event.data);
      if (event.name === "paused-for-cache") {
        buffering = event.data === true;
        if (ready && buffering && bufferStart === null) {
          bufferStart = performance.now();
          bufferCount++;
        }
        if (!buffering && bufferStart !== null) {
          bufferTotal += performance.now() - bufferStart;
          bufferStart = null;
        }
      }
    });
    for (const [index, name] of [
      "time-pos",
      "video-params",
      "paused-for-cache",
      "demuxer-cache-duration",
      "cache-speed",
    ].entries())
      await connection.observeProperty(index + 1, name);
    await connection.setProperty(
      "http-header-fields",
      Object.entries(stream.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
    );
    started = performance.now();
    timer = setTimeout(() => complete("startup-timeout"), 30_000);
    await connection.command("loadfile", stream.url, "replace");
    const outcome = await done;
    const ended = performance.now();
    if (bufferStart !== null) bufferTotal += ended - bufferStart;
    speeds.sort((a, b) => a - b);
    return {
      outcome,
      profile,
      firstReadyMs: ready ? Math.round(ready - started) : null,
      observedMs: ready ? Math.round(ended - ready) : 0,
      playheadAdvanceSeconds:
        firstPosition === null
          ? 0
          : Math.round((position - firstPosition) * 100) / 100,
      width: params?.w ?? null,
      height: params?.h ?? null,
      bufferCount,
      bufferingMs: Math.round(bufferTotal),
      minimumBufferedSeconds:
        minBuffer === Infinity ? null : Math.round(minBuffer * 100) / 100,
      medianReportedCacheBytesPerSecond: speeds.length
        ? Math.round(speeds[Math.floor(speeds.length / 2)])
        : null,
    };
  } finally {
    clearTimeout(timer);
    connection.close();
    child.kill();
  }
}

try {
  const definitions = JSON.parse(
    await readFile(
      join(process.env.APPDATA, "Vestra Nova/data/csharp-managed-sources.json"),
      "utf8",
    ),
  ).filter(
    (row) =>
      row.enabled &&
      row.type === "onlinestream-provider" &&
      (!option("--provider", "") ||
        row.id === option("--provider", "") ||
        row.name === option("--provider", "")),
  );
  if (!definitions.length)
    throw Error("No enabled anime compatibility sources are installed.");
  for (let index = 0; index < samples; index++) {
    const definition = definitions[index % definitions.length];
    const result = { provider: definition.name, sample: index + 1 };
    const worker = new api.CSharpProviderSession(
      resolve(
        option(
          "--worker",
          join(root, "apps/server/bin/Release/net10.0/Vestra.Server.dll"),
        ),
      ),
      join(scratch, `store-${index}`),
    );
    try {
      await worker.request({
        kind: "load",
        provider: {
          id: definition.id,
          type: definition.type,
          source: api.applyProviderCompatibility(
            api.transpileProvider(definition.source, definition.filename),
            definition.compatibility,
            definition,
          ),
          hosts: definition.hosts,
          preferences: definition.preferences,
        },
      });
      const call = (method, args = [], signal) =>
        worker.request(
          { kind: "call", providerId: definition.id, method, args },
          signal,
        );
      const query = option(
        "--query",
        /donghua/i.test(definition.name) ? "Battle" : "Naruto",
      );
      let at = performance.now();
      const titles = await call("search", [
        {
          query,
          dub: false,
          year: 0,
          media: {
            id: 0,
            romajiTitle: query,
            synonyms: [],
            status: "NOT_YET_RELEASED",
            format: "TV",
            episodeCount: -1,
            isAdult: false,
          },
        },
      ]);
      result.searchMs = Math.round(performance.now() - at);
      const title =
        titles[Math.floor(index / definitions.length) % titles.length];
      if (!title) throw Error("No search results.");
      result.title = title.title;
      at = performance.now();
      const episodes = await call("findEpisodes", [title.id]);
      result.episodesMs = Math.round(performance.now() - at);
      const episode = episodes[0];
      if (!episode) throw Error("No episodes.");
      result.episode = episode.number;
      const settings = await call("getSettings");
      at = performance.now();
      const rows = await api.resolveEpisodeServers(
        settings.episodeServers,
        definition.preferredServer,
        async (server, signal) => {
          try {
            return await call("findEpisodeServer", [episode, server], signal);
          } catch (error) {
            const embed = api.streamplayEmbed(error);
            if (!embed) throw error;
            return api.extractStreamplay(
              embed,
              server,
              episode.url ?? "",
              signal,
            );
          }
        },
        (row, signal) => api.probePlayableStream(row, undefined, signal),
        AbortSignal.timeout(40_000),
      );
      result.extractionMs = Math.round(performance.now() - at);
      const winner = rows[0];
      const video = api.automaticVariant(
        winner.videoSources.map((video) => ({
          ...video,
          label: video.quality,
        })),
      );
      result.server = winner.server;
      result.quality = video.quality;
      result.streamType = video.type;
      const stream = {
        ...video,
        headers: { ...winner.headers, ...video.headers },
      };
      const profile = {
        probeInfo: option("--probe-info", "auto"),
        pauseWait: Number(option("--pause-wait", "1")),
      };
      if (
        !["auto", "nostreams"].includes(profile.probeInfo) ||
        !Number.isFinite(profile.pauseWait) ||
        profile.pauseWait < 1 ||
        profile.pauseWait > 10
      )
        throw Error("Invalid playback profile.");
      if (process.argv.includes("--compare")) {
        if (process.argv.includes("--candidate-first")) {
          result.playback = await playback(stream, profile);
          result.baseline = await playback(stream);
        } else {
          result.baseline = await playback(stream);
          result.playback = await playback(stream, profile);
        }
      } else result.playback = await playback(stream, profile);
    } catch (error) {
      // Provider errors can contain signed URLs. Keep only sanitized diagnostic text.
      result.error = String(error.message)
        .replace(/https?:\/\/[^\s"']+/g, "[upstream URL]")
        .slice(0, 500);
    } finally {
      worker.stop();
    }
    report.results.push(result);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(result));
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
if (
  report.results.some(
    (row) => row.error || row.playback?.outcome !== "observed",
  )
)
  process.exitCode = 1;
