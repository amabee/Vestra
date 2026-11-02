import assert from "node:assert/strict";
import { test, after } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { createServer } from "node:http";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(
  join(root, "apps/nova/node_modules/.vyla-tests-"),
);
after(() => rm(scratch, { recursive: true, force: true, maxRetries: 5 }));
await build({
  stdin: {
    contents:
      "export {createVylaService,vylaServiceUrl} from './apps/nova/electron/vyla-service';export {createStreamSourceAdapter} from './apps/nova/electron/stream-source-adapter';",
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "test.cjs"),
  external: ["quickjs-emscripten"],
});
const { createVylaService, vylaServiceUrl, createStreamSourceAdapter } =
  createRequire(import.meta.url)(join(scratch, "test.cjs"));
const frame = (value) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const sourceEvent = (
  key = "one",
  url = "https://media.example/master.m3u8",
) => ({ type: "source", source: { source: key, url } });
const meta = {
  type: "meta",
  subtitles: [
    { label: "English", file: "https://media.example/en.vtt" },
    { label: "bad", file: "http://localhost/private" },
  ],
};
const hls = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000\nvideo.m3u8\n";
function fixture(events, options = {}) {
  const calls = [],
    hosts = [];
  let cancelled = false;
  const text = events
    .map((event) => (typeof event === "string" ? event : frame(event)))
    .join("");
  const catalogue = {
    search: async (_query, kind) => [
      {
        source: "tmdb",
        sourceId: "278",
        kind,
        title: "A movie",
        images: {},
        year: 1994,
      },
    ],
    details: async (kind, id) => ({
      source: "tmdb",
      sourceId: id,
      kind,
      seasons: [{ seasonNumber: 0 }],
    }),
    season: async () => ({
      episodes: [
        {
          seasonNumber: 0,
          episodeNumber: 1,
          title: "Special",
          airDate: "2020-01-01",
        },
      ],
    }),
    popular: async () => [],
  };
  const service = createVylaService({
    url: options.url ?? "https://service.example/api",
    token: "fixture-token",
    catalogue,
    transport: {
      publicHost: async (host) => {
        hosts.push(host);
        if (host === "blocked.internal") throw Error("Private host");
      },
      fetch: async (input, init) => {
        const url = new URL(input);
        calls.push({ url, init });
        if (url.hostname !== "service.example") {
          if (options.mediaWait)
            return new Promise((_, reject) =>
              init.signal.addEventListener(
                "abort",
                () => reject(Error("aborted")),
                { once: true },
              ),
            );
          return new Response(
            url.pathname.endsWith(".mp4")
              ? new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])
              : url.pathname.endsWith(".html")
                ? "<html>Embed</html>"
                : hls,
          );
        }
        if (options.networkError)
          throw Error("failed https://service.example/?token=secret");
        if (options.status)
          return new Response("bad", {
            status: options.status,
            headers: { "Content-Type": "text/html" },
          });
        const bytes = new TextEncoder().encode(text);
        return new Response(
          new ReadableStream({
            start(controller) {
              if (options.wait) {
                init.signal.addEventListener(
                  "abort",
                  () => controller.error(Error("aborted")),
                  { once: true },
                );
                return;
              }
              for (let index = 0; index < bytes.length; index += 3)
                controller.enqueue(bytes.slice(index, index + 3));
              if (!options.keepOpen) controller.close();
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
        );
      },
    },
  });
  return { service, calls, hosts, cancelled: () => cancelled };
}
test("service URL is explicit; only loopback HTTP or HTTPS and /api prefix are allowed", () => {
  assert.equal(
    vylaServiceUrl("http://127.0.0.1:7860").href,
    "http://127.0.0.1:7860/",
  );
  assert.equal(vylaServiceUrl("http://[::1]:7860/api").pathname, "/api/");
  for (const url of [
    "http://localhost:7860",
    "http://192.168.1.1",
    "https://user:password@host.example",
    "https://host.example/?key=x",
    "https://host.example/#x",
    "https://host.example/other",
    "file:///private",
  ])
    assert.throws(() => vylaServiceUrl(url));
});
test("split UTF-8/CRLF events start playback before completion and cancel remaining work", async () => {
  const f = fixture(
    [
      { type: "meta", title: "日本語", subtitles: meta.subtitles },
      sourceEvent(),
      sourceEvent("later"),
    ],
    { keepOpen: true },
  );
  const results = await f.service.getStreams("movie|278|s0|e0");
  assert.equal(results[0].server, "Vyla:one");
  assert.equal(results[0].videoSources[0].type, "hls");
  assert.equal(results[0].videoSources[0].quality, "auto");
  assert.equal(results[0].videoSources[0].subtitles.length, 1);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].url.pathname, "/api/movie");
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer fixture-token");
  assert.equal(f.calls[1].init.headers.Authorization, undefined);
  assert.equal(f.calls[0].init.redirect, "error");
  assert.equal(f.cancelled(), true);
});
test("mirror recovery excludes previous providers; probes actual MP4 bytes without inventing HD", async () => {
  const f = fixture([
    sourceEvent(),
    sourceEvent("two", "https://media.example/file.mp4"),
  ]);
  const result = await f.service.getStreams("tv|1396|s5|e1", undefined, {
    excludeServers: ["Vyla:one"],
  });
  assert.equal(result[0].server, "Vyla:two");
  assert.equal(result[0].videoSources[0].type, "mp4");
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].url.searchParams.get("season"), "5");
  assert.equal(f.calls[0].url.searchParams.get("episode"), "1");
});
test("HTML embeds, HTTP media, credential URLs and blocked media are skipped", async () => {
  const f = fixture([
    sourceEvent("html", "https://media.example/embed.html"),
    sourceEvent("http", "http://127.0.0.1/private"),
    sourceEvent("credentials", "https://a:b@media.example/a"),
    sourceEvent("private", "https://blocked.internal/a"),
    sourceEvent("good"),
  ]);
  assert.equal(
    (await f.service.getStreams("movie|278|s0|e0"))[0].server,
    "Vyla:good",
  );
  assert.equal(
    f.calls.some((row) => row.url.hostname === "blocked.internal"),
    false,
  );
});
test("empty, unsupported and malformed streams produce bounded errors", async () => {
  for (const [events, expected] of [
    [[{ type: "done", total: 0 }], /no playable/],
    [[sourceEvent(), { type: "done" }], /no untried/],
    [["data: invalid\n\n"], /malformed/],
    [["data: " + "x".repeat(66000)], /frame exceeds/],
    [[], /ended without/],
  ]) {
    const f = fixture(events);
    await assert.rejects(
      () =>
        f.service.getStreams("movie|278|s0|e0", undefined, {
          excludeServers: ["Vyla:one"],
        }),
      expected,
    );
  }
});
test("HTTP failure and non-SSE responses are rejected; transport errors cannot leak tokens", async () => {
  for (const status of [302, 403, 500])
    await assert.rejects(
      () => fixture([], { status }).service.getStreams("movie|278|s0|e0"),
      /expected an event stream/,
    );
  await assert.rejects(
    () =>
      fixture([], { networkError: true }).service.getStreams("movie|278|s0|e0"),
    (error) =>
      !error.message.includes("secret") &&
      /could not be reached/.test(error.message),
  );
});
test("caller cancellation and deadline interrupt SSE and media verification", async () => {
  const controller = new AbortController();
  const f = fixture([], { wait: true });
  const result = f.service.getStreams("movie|278|s0|e0", {
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(() => result, /cancelled or timed out/);
  await assert.rejects(
    () =>
      fixture([sourceEvent()], { mediaWait: true }).service.getStreams(
        "movie|278|s0|e0",
        { timeoutMs: 20 },
      ),
    /cancelled or timed out/,
  );
  await assert.rejects(
    () =>
      f.service.getStreams("movie|278|s0|e0", { signal: controller.signal }),
    /cancelled/,
  );
});
test("catalogue reuse retains season zero and service adapters have unique IDs", async () => {
  const f = fixture([]);
  assert.equal(
    (await f.service.search("movie", { kind: "movie" }))[0].id,
    "movie|278",
  );
  assert.equal((await f.service.getEpisodes("tv|1396"))[0].id, "tv|1396|s0|e1");
  assert.equal(
    createStreamSourceAdapter(f.service).id,
    "ext-stream-service-vyla",
  );
  for (const id of [
    "movie|278|s1|e1",
    "tv|1396|s0|e0",
    "tv|1396|s01|e1",
    "tv|1396|s1|e1|bad",
  ])
    await assert.rejects(() => f.service.getStreams(id), /Invalid Vyla/);
});
test("a real loopback HTTP SSE service works without changing sandbox grants", async () => {
  let requested;
  const server = createServer((req, res) => {
    requested = req.url;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(frame(sourceEvent()));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const service = createVylaService({
      url: `http://127.0.0.1:${server.address().port}`,
      transport: {
        publicHost: async (host) => assert.equal(host, "media.example"),
        fetch: (url, init) =>
          new URL(url).hostname === "127.0.0.1"
            ? fetch(url, init)
            : Promise.resolve(new Response(hls)),
      },
    });
    assert.equal(
      (await service.getStreams("tv|1396|s5|e1"))[0].server,
      "Vyla:one",
    );
    assert.equal(requested, "/tv?id=1396&season=5&episode=1");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
