import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-playback-repair-"));
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  stdin: {
    contents: `export {fetchSkipTimes} from './packages/providers/src/aniskip'; export {safeFetch} from './apps/nova/electron/safe-fetch'; export {registerDeferredVariants, resolveRemotePlayback, remoteQualities, invalidateRemotePlayback} from './apps/nova/electron/remote-playback';`,
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "repair.cjs"),
  plugins: [
    {
      name: "controlled-dns",
      setup(b) {
        b.onResolve({ filter: /^node:dns\/promises$/ }, () => ({
          path: "dns",
          namespace: "fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents:
            "export const lookup = (...args) => globalThis.fixtureLookup(...args);",
        }));
      },
    },
  ],
});
const {
  fetchSkipTimes,
  safeFetch,
  registerDeferredVariants,
  resolveRemotePlayback,
  remoteQualities,
  invalidateRemotePlayback,
} = createRequire(import.meta.url)(join(scratch, "repair.cjs"));
function network(t, fetcher) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetcher;
  globalThis.fixtureLookup = async () => [
    { address: "93.184.216.34", family: 4 },
  ];
  t.after(() => {
    globalThis.fetch = originalFetch;
    delete globalThis.fixtureLookup;
  });
}
test("OP/ED cache is scoped to runtime and rejects malformed or incompatible intervals", async (t) => {
  let calls = 0;
  network(t, async (url) => {
    calls++;
    const length = Number(new URL(url).searchParams.get("episodeLength"));
    return Response.json({
      found: true,
      results: [
        {
          skipType: "op",
          episodeLength: length,
          interval: { startTime: 30, endTime: 120 },
        },
        {
          skipType: "ed",
          episodeLength: length,
          interval: { startTime: length - 90, endTime: length },
        },
        { skipType: "op", interval: { startTime: -1, endTime: 50 } },
        { skipType: "ed", interval: { startTime: 200, endTime: length + 20 } },
        {
          skipType: "op",
          episodeLength: length + 100,
          interval: { startTime: 0, endTime: 80 },
        },
      ],
    });
  });
  const first = await fetchSkipTimes(90001, 2, 1440);
  assert.equal(first.length, 2);
  assert.equal(first[1].startSeconds, 1350);
  assert.deepEqual(await fetchSkipTimes(90001, 2, 1440), first);
  const other = await fetchSkipTimes(90001, 2, 1380);
  assert.equal(other[1].startSeconds, 1290);
  assert.equal(calls, 2);
});
test("temporary AniSkip faults do not poison subsequent lookups", async (t) => {
  let calls = 0;
  network(t, async () =>
    ++calls === 1
      ? new Response("busy", { status: 503 })
      : Response.json({
          found: true,
          results: [
            { skipType: "op", interval: { startTime: 10, endTime: 100 } },
          ],
        }),
  );
  assert.deepEqual(await fetchSkipTimes(90002, 1, 1200), []);
  assert.equal((await fetchSkipTimes(90002, 1, 1200)).length, 1);
});
test("GET retries share the original timeout including DNS; POST is never replayed", async (t) => {
  let calls = 0;
  network(t, async () => {
    calls++;
    return new Response("busy", { status: 503 });
  });
  await safeFetch({
    url: "https://source.example/video",
    method: "POST",
    timeoutMs: 1000,
  });
  assert.equal(calls, 1);
  await safeFetch({ url: "https://source.example/video", timeoutMs: 50 });
  assert.equal(calls, 2, "no backoff can fit into a 50ms budget");
  globalThis.fixtureLookup = () => new Promise(() => {});
  const start = Date.now();
  await assert.rejects(
    safeFetch({ url: "https://source.example/video", timeoutMs: 30 }),
    /timed out/,
  );
  assert.ok(Date.now() - start < 300, "slow DNS is inside the request budget");
});
test("GET can recover once within budget, without exposing token paths in logs", async (t) => {
  let calls = 0;
  network(
    t,
    async () =>
      new Response(++calls === 1 ? "busy" : "ready", {
        status: calls === 1 ? 503 : 200,
      }),
  );
  const logs = [];
  const warn = console.warn;
  console.warn = (line) => logs.push(line);
  t.after(() => (console.warn = warn));
  const result = await safeFetch({
    url: "https://source.example/private-token?secret=hidden",
    timeoutMs: 1000,
  });
  assert.equal(result.body, "ready");
  assert.equal(calls, 2);
  assert.ok(
    logs.every(
      (line) => !line.includes("hidden") && !line.includes("private-token"),
    ),
  );
});
test("hover, quality choices and playback share extraction; failed media invalidates signed URLs", async () => {
  let calls = 0;
  const locator = registerDeferredVariants(async () => {
    calls++;
    return [
      {
        key: "1080",
        label: "1080p",
        playback: {
          url: `https://cdn.example/video?token=${calls}`,
          headers: {},
          subtitles: [],
        },
      },
    ];
  });
  const [choices, auto] = await Promise.all([
    remoteQualities(locator),
    resolveRemotePlayback(locator),
  ]);
  assert.equal(calls, 1);
  assert.equal((await resolveRemotePlayback(choices[0].locator)).url, auto.url);
  invalidateRemotePlayback(locator);
  assert.notEqual(
    (await resolveRemotePlayback(choices[0].locator)).url,
    auto.url,
  );
  assert.equal(calls, 2);
});
