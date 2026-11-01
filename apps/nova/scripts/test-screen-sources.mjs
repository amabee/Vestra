import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(
  join(root, "apps/nova/node_modules/.screen-tests-"),
);
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  stdin: {
    contents: `export {ScreenService} from './apps/nova/electron/screen-service';export {StreamSourceRegistry,createStreamSourceProvider,parseAnimeResults,parseEpisodes} from './packages/extension-host/src/index';export {sourceEpisodeQueue,createStreamSourceAdapter} from './apps/nova/electron/stream-source-adapter';export {resolveRemotePlayback} from './apps/nova/electron/remote-playback';export {mediaItemSchema} from './packages/types/src/index';`,
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "test.cjs"),
  external: ["quickjs-emscripten"],
});
const {
  ScreenService,
  StreamSourceRegistry,
  createStreamSourceProvider,
  parseAnimeResults,
  parseEpisodes,
  sourceEpisodeQueue,
  createStreamSourceAdapter,
  resolveRemotePlayback,
  mediaItemSchema,
} = createRequire(import.meta.url)(join(scratch, "test.cjs"));
const title = (id, kind) => ({
  id,
  kind,
  title: "Title " + id,
  year: 2025,
  provider: "ext-screen",
});
const item = (kind = "tv") =>
  mediaItemSchema.parse({
    source: "ext-screen",
    sourceId: "show",
    kind,
    title: "Show",
    images: {},
    rating: {},
    isSeries: kind === "tv",
  });
function fixture(overrides = {}) {
  const calls = [];
  const source = {
    id: "ext-screen",
    name: "Screen",
    kinds: ["movie", "tv"],
    browseCategories: ["popular"],
    search: async (query, options) => {
      calls.push(["search", query, options]);
      return [
        title("film", "movie"),
        title("show", "tv"),
        { id: "ambiguous", title: "Missing kind" },
      ];
    },
    browse: async (category, options) => {
      calls.push(["browse", category, options]);
      return {
        items: [title("film", "movie"), title("show", "tv")],
        hasMore: options.page < 2,
      };
    },
    getEpisodes: async () => {
      calls.push(["episodes"]);
      return [
        { id: "s2e1", animeId: "show", season: 2, number: 1 },
        { id: "s1e1", animeId: "show", season: 1, number: 1 },
        { id: "other", animeId: "wrong", number: 1 },
      ];
    },
    getStreams: async (id) => {
      calls.push(["streams", id]);
      return [
        {
          server: "One",
          videoSources: [
            {
              url: "https://example.com/" + id + ".mp4",
              type: "mp4",
              quality: "1080p",
            },
          ],
        },
      ];
    },
    ...overrides,
  };
  const registry = new StreamSourceRegistry();
  registry.register(source);
  return { registry, source, service: new ScreenService(registry), calls };
}
test("SDK preserves mixed-source kinds, remake years and season zero, rejects malformed fields", () => {
  assert.equal(
    parseAnimeResults([title("film", "movie")]).value[0].kind,
    "movie",
  );
  assert.equal(
    parseAnimeResults([{ ...title("film", "movie"), year: -1 }]).value.length,
    0,
  );
  assert.equal(
    parseEpisodes([{ id: "special", animeId: "show", number: 1, season: 0 }])
      .value[0].season,
    0,
  );
  assert.equal(
    parseEpisodes([{ id: "invalid", animeId: "show", number: 1, season: 1.5 }])
      .value.length,
    0,
  );
});
test("Movies and TV search keeps distinct kinds, host identity and bounded cached requests", async () => {
  const f = fixture();
  assert.equal(f.service.list("movie").length, 1);
  const page = await f.service.load({
    kind: "movie",
    source: f.source.id,
    query: "title",
  });
  assert.deepEqual(
    page.items.map((row) => row.sourceId),
    ["film"],
  );
  assert.equal(page.items[0].source, f.source.id);
  assert.equal(page.items[0].isSeries, false);
  await f.service.load({ kind: "movie", source: f.source.id, query: "title" });
  assert.equal(f.calls.length, 1);
  const tv = await f.service.load({
    kind: "tv",
    source: f.source.id,
    query: "title",
  });
  assert.equal(tv.items[0].isSeries, true);
  assert.equal(f.calls.at(-1)[2].kind, "tv");
  await assert.rejects(f.service.load({ kind: "anime", source: f.source.id }));
  await assert.rejects(
    f.service.load({ kind: "tv", source: f.source.id, page: 101 }),
  );
});
test("Collections pass kind and pagination; search-only sources remain searchable", async () => {
  const f = fixture();
  const page = await f.service.load({
    kind: "tv",
    source: f.source.id,
    category: "popular",
    page: 2,
  });
  assert.equal(page.hasMore, false);
  assert.equal(f.calls[0][2].kind, "tv");
  assert.equal(f.service.remembered(page.items[0]).sourceId, "show");
  const single = fixture({
    kinds: ["movie"],
    browse: undefined,
    browseCategories: [],
    search: async () => [{ id: "old", title: "Single kind legacy" }],
  });
  assert.equal(
    (
      await single.service.load({
        kind: "movie",
        source: single.source.id,
        query: "old",
      })
    ).items.length,
    1,
  );
  assert.deepEqual(
    (await single.service.load({ kind: "movie", source: single.source.id }))
      .items,
    [],
  );
});
test("Seasons sort without colliding, streams resolve lazily and progress survives handle refresh", async () => {
  const f = fixture();
  const first = await f.service.open(item());
  const again = await f.service.open(item());
  assert.deepEqual(
    first.queue.map((row) => row.season),
    [1, 2],
  );
  assert.notEqual(first.queue[0].progressId, first.queue[1].progressId);
  assert.equal(first.queue[0].progressId, again.queue[0].progressId);
  assert.notEqual(first.queue[0].locator, again.queue[0].locator);
  assert.equal(f.calls.filter((row) => row[0] === "episodes").length, 1);
  assert.equal(
    f.calls.some((row) => row[0] === "streams"),
    false,
  );
  assert.equal(
    (await resolveRemotePlayback(first.queue[1].locator)).url,
    "https://example.com/s2e1.mp4",
  );
  f.registry.setEnabled(f.source.id, false);
  await assert.rejects(
    resolveRemotePlayback(first.queue[0].locator),
    /changed/,
  );
  await assert.rejects(f.service.open(item()), /disabled/);
});
test("Movies omit episode/season fields, and foreign-title or duplicate episodes are excluded", () => {
  const f = fixture();
  const queue = sourceEpisodeQueue(
    f.source,
    item("movie"),
    [
      { id: "feature", animeId: "show", number: 1, season: 1 },
      { id: "feature", animeId: "show", number: 1 },
      { id: "foreign", animeId: "other", number: 1 },
    ],
    () => {},
  );
  assert.equal(queue.length, 1);
  assert.equal(queue[0].episode, undefined);
  assert.equal(queue[0].season, undefined);
});
test("Disabling or replacing an extension invalidates cached results and outstanding requests", async () => {
  let release;
  const f = fixture({
    search: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const request = f.service.load({
    kind: "movie",
    source: f.source.id,
    query: "title",
  });
  f.registry.unregister(f.source.id);
  f.registry.register({ ...f.source });
  release([title("film", "movie")]);
  await assert.rejects(request, /changed/);
  assert.equal(
    f.service.remembered({
      source: f.source.id,
      sourceId: "film",
      kind: "movie",
    }),
    null,
  );
});
test("Provider bridge forwards requested media kind and validates returned season metadata", async () => {
  const calls = [];
  const provider = createStreamSourceProvider({
    extensionId: "screen",
    name: "Screen",
    kinds: ["movie", "tv"],
    methods: ["search", "browse", "getEpisodes", "getStreams"],
    browseCategories: ["popular"],
    call: async (method, args) => {
      calls.push([method, args]);
      if (method === "getEpisodes")
        return [{ id: "s2e1", animeId: "show", season: 2, number: 1 }];
      if (method === "browse")
        return { items: [title("show", "tv")], hasMore: false };
      return [title("film", "movie")];
    },
  });
  assert.equal(
    (await provider.search("film", { kind: "movie" }))[0].kind,
    "movie",
  );
  assert.equal(calls.at(-1)[1][1].kind, "movie");
  await provider.browse("popular", { kind: "tv", page: 1, limit: 24 });
  assert.equal(calls.at(-1)[1][1].kind, "tv");
  assert.equal((await provider.getEpisodes("show"))[0].season, 2);
});
test("Direct native playback reuses source IDs and catalogue matching rejects wrong remake years", async () => {
  const f = fixture();
  const adapter = createStreamSourceAdapter(f.source);
  const queue = await adapter.resolve(item(), {
    timeoutMs: 1000,
    signal: AbortSignal.timeout(1000),
  });
  assert.equal(queue.length, 2);
  assert.equal(
    f.calls.some((row) => row[0] === "search"),
    false,
  );
  const remakes = fixture({
    search: async () => [
      { ...title("older", "movie"), title: "Show", year: 1980 },
      { ...title("newer", "movie"), title: "Show", year: 2025 },
    ],
    getEpisodes: async (id) => [{ id: "feature", animeId: id, number: 1 }],
  });
  const result = await createStreamSourceAdapter(remakes.source).resolve(
    { ...item("movie"), source: "tmdb", year: 2025 },
    { timeoutMs: 1000, signal: AbortSignal.timeout(1000) },
  );
  assert.equal(result.length, 1);
});
