import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-buffering-"));
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  stdin: {
    contents: `export {probePlayableStream} from './apps/nova/electron/probe-stream'; export {MpvSession} from './apps/nova/electron/mpv/session'; export {automaticVariant, STREAM_CACHE_ARGS} from './apps/nova/electron/mpv/stream-policy'; export {registerDeferredVariants, resolveRemotePlayback, remoteQualities, isAutomaticStream} from './apps/nova/electron/remote-playback';`,
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "fixture.cjs"),
  plugins: [
    {
      name: "native-fixture",
      setup(b) {
        b.onResolve({ filter: /^electron$/ }, () => ({
          path: "electron",
          namespace: "fixture",
        }));
        b.onResolve({ filter: /^node:child_process$/ }, () => ({
          path: "spawn",
          namespace: "fixture",
        }));
        b.onResolve({ filter: /^\.\/connection$/ }, () => ({
          path: "connection",
          namespace: "fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
          contents:
            path === "electron"
              ? `export const app={isPackaged:false,getAppPath:()=>"fixture",getPath:()=>"fixture"};`
              : path === "spawn"
                ? `import {EventEmitter} from 'node:events';export function spawn(_binary,args){globalThis.fixtureArgs=args;const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};return child;}`
                : `export class MpvConnection { constructor(){globalThis.fixtureConnection=this;this.writes=[];} async connect(){} async observeProperty(){} onEvent(fn){this.emit=fn;} async setProperty(...args){this.writes.push(['set',...args]);} async command(...args){this.writes.push(args);if(args[0]==='loadfile'){this.emit({event:'start-file'});this.emit({event:'file-loaded'});}} close(){} }`,
        }));
      },
    },
  ],
});
const {
  probePlayableStream,
  MpvSession,
  automaticVariant,
  STREAM_CACHE_ARGS,
  registerDeferredVariants,
  resolveRemotePlayback,
  remoteQualities,
  isAutomaticStream,
} = createRequire(import.meta.url)(join(scratch, "fixture.cjs"));
const remote = {
  url: "https://cdn.example/video.m3u8",
  headers: {},
  subtitles: [],
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
async function sessionFixture(t, automatic = true) {
  const session = new MpvSession();
  await session.start(
    { getNativeWindowHandle: () => Buffer.alloc(8) },
    { mpvPath: process.execPath },
  );
  await session.load(remote.url, 42, remote, automatic, false, async () => ({
    ...remote,
    url: "https://cdn.example/480.m3u8",
  }));
  const connection = globalThis.fixtureConnection;
  connection.emit({ event: "property-change", name: "pause", data: false });
  connection.emit({ event: "property-change", name: "time-pos", data: 42 });
  await settle();
  t.after(() => session.stop());
  return { session, connection };
}
test("automatic playback chooses balanced quality; explicit HD stays exact", async () => {
  const rows = [1080, 480, 720].map((height) => ({
    key: String(height),
    label: `${height}p · Main`,
    playback: { ...remote, url: `https://cdn.example/${height}.m3u8` },
  }));
  assert.equal(automaticVariant(rows).key, "720");
  const locator = registerDeferredVariants(async () => rows);
  assert.match((await resolveRemotePlayback(locator)).url, /720/);
  assert.match((await resolveRemotePlayback(locator, true)).url, /480/);
  const hd = (await remoteQualities(locator)).find((row) =>
    row.label.startsWith("1080"),
  );
  assert.match((await resolveRemotePlayback(hd.locator)).url, /1080/);
  assert.equal(isAutomaticStream(locator), true);
  assert.equal(isAutomaticStream(hd.locator), false);
});
test("native profile bounds network waits and resets quality cap for local files", async (t) => {
  const { session, connection } = await sessionFixture(t);
  assert.ok(globalThis.fixtureArgs.includes("--no-config"));
  for (const arg of STREAM_CACHE_ARGS)
    assert.ok(globalThis.fixtureArgs.includes(arg));
  assert.ok(
    connection.writes.some(
      (row) => row[1] === "options/hls-bitrate" && row[2] === 3000000,
    ),
  );
  await session.load("owned.mkv", 0);
  assert.ok(
    connection.writes.some(
      (row) => row[1] === "options/hls-bitrate" && row[2] === "max",
    ),
  );
});
test("persistent automatic stall reloads once at lower bandwidth and preserves position, then stops", async (t) => {
  const { session, connection } = await sessionFixture(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  connection.emit({
    event: "property-change",
    name: "paused-for-cache",
    data: true,
  });
  t.mock.timers.tick(12001);
  await settle();
  assert.ok(
    connection.writes.some(
      (row) => row[1] === "options/hls-bitrate" && row[2] === 900000,
    ),
  );
  assert.ok(
    connection.writes.some(
      (row) => row[1] === "options/start" && row[2] === "42",
    ),
  );
  assert.equal(
    connection.writes.filter((row) => row[0] === "loadfile").length,
    2,
  );
  assert.ok(
    connection.writes.some(
      (row) => row[0] === "loadfile" && row[1].includes("480.m3u8"),
    ),
  );
  connection.emit({
    event: "property-change",
    name: "paused-for-cache",
    data: true,
  });
  t.mock.timers.tick(12001);
  await settle();
  assert.match(session.state.error, /stopped delivering data/);
  assert.equal(
    connection.writes.filter((row) => row[0] === "loadfile").length,
    2,
  );
});
test("pause cancels recovery and manual quality is never silently downgraded", async (t) => {
  const { session, connection } = await sessionFixture(t, false);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  connection.emit({
    event: "property-change",
    name: "paused-for-cache",
    data: true,
  });
  connection.emit({ event: "property-change", name: "pause", data: true });
  t.mock.timers.tick(20000);
  await settle();
  assert.equal(session.state.error, null);
  connection.emit({ event: "property-change", name: "pause", data: false });
  t.mock.timers.tick(12001);
  await settle();
  assert.match(session.state.error, /stopped delivering data/);
  assert.equal(
    connection.writes.filter((row) => row[0] === "loadfile").length,
    1,
  );
});

test("startup probes only a usable balanced manifest, retaining other qualities", async () => {
  const result = {
    server: "Main",
    headers: {},
    videoSources: [1080, 720, 480].map((h) => ({
      type: "hls",
      quality: `${h}p`,
      url: `https://cdn.example/${h}.m3u8`,
      subtitles: [],
    })),
  };
  const requests = [];
  const checked = await probePlayableStream(result, async (input) => {
    requests.push(input.url);
    return { status: 200, headers: {}, body: "#EXTM3U" };
  });
  assert.deepEqual(requests, ["https://cdn.example/720.m3u8"]);
  assert.equal(checked.videoSources.length, 3);
  requests.length = 0;
  const recovered = await probePlayableStream(result, async (input) => {
    requests.push(input.url);
    return {
      status: input.url.includes("720") ? 503 : 200,
      headers: {},
      body: "#EXTM3U",
    };
  });
  assert.deepEqual(requests, [
    "https://cdn.example/720.m3u8",
    "https://cdn.example/480.m3u8",
  ]);
  assert.equal(recovered.videoSources.length, 2);
});
