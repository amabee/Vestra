import { spawn } from "node:child_process";
import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-servers-"));
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  stdin: {
    contents: `export {resolveEpisodeServers} from './apps/nova/electron/episode-servers'; export {CSharpProviderWorker} from './apps/nova/electron/csharp-worker'; export {transpileProvider} from './apps/nova/electron/provider-transpile'; export {safeFetch} from './apps/nova/electron/safe-fetch';`,
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "test.cjs"),
});
const {
  resolveEpisodeServers,
  CSharpProviderWorker,
  transpileProvider,
  safeFetch,
} = createRequire(import.meta.url)(join(scratch, "test.cjs"));
const result = (server) => ({
  server,
  headers: { Referer: "https://source.example/" },
  videoSources: [
    {
      type: "m3u8",
      url: "https://cdn.example/video.m3u8",
      quality: "1080p",
      subtitles: [{ url: "https://cdn.example/en.vtt", language: "en" }],
    },
  ],
});
test("unsupported preferred embed falls back to an advertised mirror and keeps stream headers and subtitles", async () => {
  const calls = [];
  const rows = await resolveEpisodeServers(
    ["One", "Two"],
    "Two",
    async (server) => {
      calls.push(server);
      if (server === "Two")
        throw Error(
          "No scraper implemented for embed host: https://play.example/embed/private-token",
        );
      return result(server);
    },
  );
  assert.deepEqual(calls, ["Two", "One"]);
  assert.equal(rows[0].videoSources[0].type, "hls");
  assert.equal(rows[0].headers.Referer, "https://source.example/");
  assert.ok(rows[0].videoSources[0].subtitles[0].id);
});
test("invalid manifests and unsupported media are rejected before selecting a mirror", async () => {
  let calls = 0;
  const rows = await resolveEpisodeServers(
    ["One", "Two"],
    undefined,
    async (server) => result(server),
    async (row) => {
      if (++calls === 1) throw Error("Video manifest HTTP 403");
      return row;
    },
  );
  assert.equal(rows[0].server, "Two");
  await assert.rejects(
    resolveEpisodeServers(["One"], undefined, async () => ({
      ...result("One"),
      videoSources: [{ type: "html", url: "https://example.com/embed" }],
    })),
    /No playable mirror/,
  );
});
test("all-server failure is actionable and strips signed URLs; cancellation stops fallback", async () => {
  await assert.rejects(
    resolveEpisodeServers(["One", "Two"], undefined, async () => {
      throw Error(
        "No scraper implemented for embed host: https://play.example/embed/private-token",
      );
    }),
    (error) =>
      /play.example/.test(error.message) &&
      !error.message.includes("private-token") &&
      /another extension/.test(error.message),
  );
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    resolveEpisodeServers(
      ["One", "Two"],
      undefined,
      async () => {
        calls++;
        controller.abort();
        throw Error("Cancelled");
      },
      undefined,
      controller.signal,
    ),
  );
  assert.equal(calls, 1);
});
if (process.argv.includes("--live"))
  test("installed anime extension resolves a reachable HLS mirror", async () => {
    const definitions = JSON.parse(
      await readFile(
        join(
          process.env.APPDATA,
          "Vestra Nova/data/csharp-managed-sources.json",
        ),
        "utf8",
      ),
    );
    const definition = definitions.find(
      (row) => row.enabled && row.type === "onlinestream-provider",
    );
    assert.ok(definition, "No installed anime provider to verify");
    const worker = new CSharpProviderWorker(
      join(root, "apps/server/bin/Release/net10.0/Vestra.Server.dll"),
      join(scratch, "worker-store"),
    );
    try {
      await worker.request({
        kind: "load",
        provider: {
          id: definition.id,
          type: definition.type,
          source: transpileProvider(definition.source, definition.filename),
          hosts: definition.hosts,
          preferences: definition.preferences,
        },
      });
      const call = (method, args = []) =>
        worker.request({
          kind: "call",
          providerId: definition.id,
          method,
          args,
        });
      const titles = await call("search", [
        {
          query: "Battle",
          dub: false,
          year: 0,
          media: {
            id: 0,
            romajiTitle: "Battle",
            synonyms: [],
            status: "NOT_YET_RELEASED",
            format: "TV",
            episodeCount: -1,
            isAdult: false,
          },
        },
      ]);
      assert.ok(titles.length);
      const episodes = await call("findEpisodes", [titles[0].id]);
      assert.ok(episodes.length);
      const settings = await call("getSettings");
      const rows = await resolveEpisodeServers(
        settings.episodeServers,
        definition.preferredServer,
        (server) => call("findEpisodeServer", [episodes[0], server]),
        async (row) => {
          for (const video of row.videoSources) {
            const response = await safeFetch({
              url: video.url,
              headers: { ...row.headers, ...video.headers },
              maxBytes: 1048576,
              timeoutMs: 7000,
            });
            assert.equal(response.status, 200);
            assert.match(response.body.trimStart(), /^#EXTM3U/);
          }
          return row;
        },
      );
      console.log(
        "LIVE",
        JSON.stringify({
          provider: definition.name,
          title: titles[0].title,
          episodes: episodes.length,
          server: rows[0].server,
          manifest: "verified",
        }),
      );
      if (process.argv.includes("--native")) {
        const log = join(scratch, "mpv.log");
        const video = rows[0].videoSources[0];
        const headers = Object.entries({ ...rows[0].headers, ...video.headers })
          .map(([key, value]) => `${key}: ${value}`)
          .join(",");
        const code = await new Promise((resolve, reject) => {
          const child = spawn(
            join(root, "apps/nova/vendor/mpv/mpv.exe"),
            [
              "--no-config",
              "--vo=null",
              "--ao=null",
              "--no-audio",
              "--frames=1",
              "--network-timeout=10",
              "--terminal=no",
              `--log-file=${log}`,
              `--http-header-fields=${headers}`,
              video.url,
            ],
            { windowsHide: true, stdio: "ignore" },
          );
          const timer = setTimeout(() => {
            child.kill();
            reject(Error("Native video decode timed out"));
          }, 30000);
          child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.on("exit", (code) => {
            clearTimeout(timer);
            resolve(code);
          });
        });
        const output = await readFile(log, "utf8");
        assert.equal(code, 0, "Native mpv failed");
        assert.match(
          output,
          /VO: \[null\] \d+x\d+/,
          "mpv did not output a decoded video frame",
        );
        console.log(
          "LIVE native mpv decoded a video frame using the installed extension's stream and headers (hidden, null video output)",
        );
      }
      if (process.env.VESTRA_ANIME_LIVE_RESULT)
        await writeFile(
          process.env.VESTRA_ANIME_LIVE_RESULT,
          JSON.stringify(rows[0]),
        );
    } finally {
      worker.stop();
    }
  });
