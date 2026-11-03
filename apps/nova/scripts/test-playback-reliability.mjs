import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { test, after } from "node:test";
const scratch = await mkdtemp(join(tmpdir(), "vestra-reliability-"));
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  stdin: {
    contents: `export {PlaybackCheckpoint,playbackSourceLink,sourceRecoveryResume} from './apps/nova/renderer/src/lib/playback-recovery';export {preferredMangaSource,rememberMangaSource} from './apps/nova/renderer/src/lib/manga-source-preference';`,
    resolveDir: resolve("."),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "test.cjs"),
});
const {
  PlaybackCheckpoint,
  playbackSourceLink,
  sourceRecoveryResume,
  preferredMangaSource,
  rememberMangaSource,
} = createRequire(import.meta.url)(join(scratch, "test.cjs"));
test("retry uses the last ready playback position, survives error resets and separates sessions", () => {
  const clock = new PlaybackCheckpoint();
  clock.observe(1, 0, false, 40);
  assert.equal(clock.read(1, 0), 40);
  clock.observe(1, 125, true, 40);
  clock.observe(1, 0, false, 40);
  assert.equal(clock.read(1, 40), 125);
  clock.observe(1, NaN, true, 40);
  assert.equal(clock.read(1, 40), 125);
  clock.observe(1, 0, true, 40);
  assert.equal(
    clock.read(1, 40),
    0,
    "a real seek to the beginning is retained",
  );
  clock.observe(2, 125, false, null);
  assert.equal(clock.read(2, 0), 0);
  assert.equal(clock.read(3, 17), 17);
});
test("source recovery only resumes the exact numbered episode and season, never a queue index", () => {
  const item = { source: "anilist", kind: "anime", sourceId: "42" };
  const url = new URL(
    playbackSourceLink(item, { episode: 12, season: 2 }, 481),
    "https://vestra.example",
  );
  assert.equal(url.pathname, "/media/anilist/anime/42");
  assert.equal(url.searchParams.get("chooseSource"), "1");
  assert.deepEqual(
    sourceRecoveryResume(url.searchParams, [
      { episode: 12, season: 1 },
      { episode: 12, season: 2 },
    ]),
    { index: 1, startAt: 481 },
  );
  assert.equal(
    sourceRecoveryResume(url.searchParams, [
      { episode: 1, season: 2 },
      { episode: 12, season: 1 },
    ]),
    null,
  );
  url.searchParams.set("resumeAt", "Infinity");
  assert.equal(
    sourceRecoveryResume(url.searchParams, [{ episode: 12, season: 2 }]),
    null,
  );
  assert.equal(
    sourceRecoveryResume(new URLSearchParams(), [{ episode: 1 }]),
    null,
  );
});
test("recovery links keep source IDs as internal path data and omit stream URLs", () => {
  const link = playbackSourceLink(
    {
      source: "ext-provider",
      kind: "anime",
      sourceId: "https://example/title?a=1",
    },
    { episode: 2, locator: "https://cdn.example/private?token=secret" },
    30,
  );
  assert.ok(link.startsWith("/media/ext-provider/anime/https%3A%2F%2F"));
  assert.doesNotMatch(link, /secret|cdn\.example/);
});
test("manga source choice is remembered per catalogue title and ignores removed sources or broken storage", () => {
  const rows = new Map();
  globalThis.localStorage = {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, value),
  };
  const sources = [{ id: "first" }, { id: "second" }];
  assert.equal(preferredMangaSource(42, sources), "");
  rememberMangaSource(42, "second");
  assert.equal(preferredMangaSource(42, sources), "second");
  assert.equal(preferredMangaSource(43, sources), "");
  assert.equal(preferredMangaSource(42, [{ id: "first" }]), "first");
  rows.set("vestra-manga-sources-v1", "invalid");
  assert.equal(preferredMangaSource(42, sources), "");
  globalThis.localStorage = {
    getItem() {
      throw Error("unavailable");
    },
    setItem() {
      throw Error("unavailable");
    },
  };
  assert.doesNotThrow(() => rememberMangaSource(42, "first"));
  assert.equal(preferredMangaSource(42, sources), "");
  delete globalThis.localStorage;
});
