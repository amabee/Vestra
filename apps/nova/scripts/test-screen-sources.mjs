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
    contents: `export {withSourceCatalogue} from './apps/nova/electron/catalogue-stream-source';export {screenPosterUrl} from './apps/nova/renderer/src/components/media/screen-artwork';export {ScreenFeedModel,ScreenFeedSessions} from './apps/nova/renderer/src/components/media/screen-feed-model';export {ScreenService} from './apps/nova/electron/screen-service';export {StreamSourceRegistry,createStreamSourceProvider,parseAnimeResults,parseEpisodes} from './packages/extension-host/src/index';export {sourceEpisodeQueue,createStreamSourceAdapter} from './apps/nova/electron/stream-source-adapter';export {resolveRemotePlayback,createRemoteRecovery} from './apps/nova/electron/remote-playback';export {mediaItemSchema,playbackSourceSchema} from './packages/types/src/index';`,
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "test.cjs"),
  external: ["quickjs-emscripten"],
});
const {
  withSourceCatalogue,
  screenPosterUrl,
  ScreenFeedModel,
  ScreenFeedSessions,
  ScreenService,
  StreamSourceRegistry,
  createStreamSourceProvider,
  parseAnimeResults,
  parseEpisodes,
  sourceEpisodeQueue,
  createStreamSourceAdapter,
  resolveRemotePlayback,
  createRemoteRecovery,
  mediaItemSchema,
  playbackSourceSchema,
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

test("Details switch to the selected provider using its exact title ID and lazy stream queue", async () => {
  const f = fixture();
  const calls = [];
  f.registry.register({
    ...f.source,
    id: "ext-other",
    name: "Other",
    search: async (_query, options) => {
      calls.push(options);
      return [{ id: "other-show", title: "Show", kind: "tv" }];
    },
    getEpisodes: async (id) => {
      calls.push(id);
      return [{ id: "other-e1", animeId: id, number: 1 }];
    },
  });
  const result = await f.service.open(item(), "ext-other");
  assert.equal(result.item.sourceId, "other-show");
  assert.equal(result.item.source, "ext-other");
  assert.equal(result.queue.length, 1);
  assert.equal(calls[0].kind, "tv");
  assert.equal(calls[1], "other-show");
  assert.equal(
    f.calls.some((row) => row[0] === "streams"),
    false,
  );
  f.registry.setEnabled("ext-other", false);
  await assert.rejects(
    f.service.open(item(), "ext-other"),
    /disabled|unavailable/,
  );
});

test("Provider switching rejects a wrong remake or ambiguous edition", async () => {
  const f = fixture();
  const target = { ...item(), year: 2025 };
  f.registry.register({
    ...f.source,
    id: "ext-other",
    search: async () => [
      { id: "wrong", title: "Show", kind: "tv", year: 1999 },
    ],
  });
  await assert.rejects(f.service.open(target, "ext-other"), /no exact match/);
  f.registry.register({
    ...f.source,
    id: "ext-ambiguous",
    search: async () => [
      { id: "one", title: "Show", kind: "tv", year: 2025 },
      { id: "two", title: "Show", kind: "tv", year: 2025 },
    ],
  });
  await assert.rejects(
    f.service.open(target, "ext-ambiguous"),
    /Multiple source editions/,
  );
});

test("KissKH year suffixes match the same release but never a wrong remake or ambiguous edition", async () => {
  const f = fixture();
  const target = { ...item(), title: "Love in Disguise", year: 2026 };
  const register = (rows) => {
    f.registry.unregister("ext-kisskh");
    f.registry.register({
      ...f.source,
      id: "ext-kisskh",
      search: async () => rows,
      getEpisodes: async (id) => [{ id: "episode", animeId: id, number: 1 }],
    });
  };
  register([{ id: "tv|13788", title: "Love in Disguise (2026)", kind: "tv" }]);
  const result = await f.service.open(target, "ext-kisskh");
  assert.equal(result.item.sourceId, "tv|13788");
  assert.equal(result.queue.length, 1);
  register([{ id: "wrong", title: "Love in Disguise (2025)", kind: "tv" }]);
  await assert.rejects(f.service.open(target, "ext-kisskh"), /no exact match/);
  register([
    { id: "wrong", title: "Love in Disguise (2025)", year: 2026, kind: "tv" },
  ]);
  await assert.rejects(f.service.open(target, "ext-kisskh"), /no exact match/);
  register([
    { id: "one", title: "Love in Disguise (2026)", kind: "tv" },
    { id: "two", title: "Love in Disguise", year: 2026, kind: "tv" },
  ]);
  await assert.rejects(
    f.service.open(target, "ext-kisskh"),
    /Multiple source editions/,
  );
});

test("Long feeds keep earlier title snapshots available for details", async () => {
  const f = fixture({
    browse: async (_category, { page }) => ({
      items: Array.from({ length: 24 }, (_, index) =>
        title(`page-${page}-${index}`, "movie"),
      ),
      hasMore: page < 100,
    }),
  });
  const first = await f.service.load({
    kind: "movie",
    source: f.source.id,
    page: 1,
  });
  for (let page = 2; page <= 30; page++)
    await f.service.load({ kind: "movie", source: f.source.id, page });
  assert.equal(f.service.remembered(first.items[0]).sourceId, "page-1-0");
});

test("Feed starts at 14, appends 7, buffers fixed pages and keeps only one request active", async () => {
  let active = 0,
    maxActive = 0;
  const calls = [];
  const providers = [
    { id: "first", name: "First", categories: ["popular"] },
    { id: "second", name: "Second", categories: ["popular"] },
  ];
  const model = new ScreenFeedModel(providers, async (source, page) => {
    active++;
    maxActive = Math.max(maxActive, active);
    calls.push([source, page]);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return {
      items: Array.from({ length: 10 }, (_, index) => ({
        ...item("movie"),
        source,
        sourceId: `${source}-${page}-${index}`,
        title: `${source} ${page} ${index}`,
        year: 2025,
      })),
      hasMore: page < 5,
    };
  });
  const first = await model.read(0);
  assert.equal(first.items.length, 14);
  assert.equal(calls.length, 2);
  assert.equal(maxActive, 1);
  const next = await model.read(1);
  assert.equal(next.items.length, 7);
  assert.equal(calls.length, 3);
  const third = await model.read(2);
  assert.equal(third.items.length, 7);
  assert.equal(calls.length, 3, "Reuse leftovers before another request");
  assert.equal(
    new Set(
      [...first.items, ...next.items, ...third.items].map(
        (row) => row.sourceId,
      ),
    ).size,
    28,
  );
  assert.deepEqual(
    await model.read(0),
    first,
    "Cached batch replays without advancing upstream pages",
  );
  assert.equal(calls.length, 3);
});

test("Screen browse forwards a stable bounded page size and rejects invalid limits", async () => {
  const f = fixture();
  await f.service.load({ kind: "movie", source: f.source.id, limit: 14 });
  assert.equal(f.calls[0][2].limit, 14);
  await assert.rejects(
    f.service.load({ kind: "movie", source: f.source.id, limit: 100 }),
  );
});

test("Feed sessions reuse cached batches across navigation and refresh only on request", async () => {
  let fetches = 0;
  const cache = new ScreenFeedSessions(2);
  const create = () =>
    new ScreenFeedModel(
      [{ id: "source", name: "Source", categories: [] }],
      async () => {
        fetches++;
        return {
          items: Array.from({ length: 14 }, (_, index) => ({
            ...item("movie"),
            sourceId: String(index),
            title: String(index),
          })),
          hasMore: false,
        };
      },
    );
  const first = cache.get("movie", create);
  await first.read(0);
  const again = cache.get("movie", create);
  assert.equal(again, first);
  assert.equal(again.snapshot().pages[0].items.length, 14);
  await again.read(0);
  assert.equal(fetches, 1);
  const refreshed = cache.get("movie", create, true);
  assert.notEqual(refreshed, first);
  await refreshed.read(0);
  assert.equal(fetches, 2);
  cache.get("tv", create);
  cache.get("search", create);
  assert.notEqual(
    cache.get("movie", create),
    refreshed,
    "Bounded session eviction",
  );
});

test("Metadata survives the old two-minute expiry; explicit refresh and provider replacement invalidate it", async () => {
  const f = fixture();
  const request = { kind: "movie", source: f.source.id, page: 1, limit: 14 };
  const realNow = Date.now;
  try {
    await f.service.load(request);
    Date.now = () => realNow() + 180000;
    await f.service.load(request);
    assert.equal(f.calls.length, 1);
    await f.service.load({ ...request, refresh: true });
    assert.equal(f.calls.length, 2);
    await f.service.load(request);
    assert.equal(f.calls.length, 2);
    const before = f.service.list("movie")[0].revision;
    f.registry.unregister(f.source.id);
    f.registry.register({ ...f.source });
    assert.notEqual(f.service.list("movie")[0].revision, before);
    await f.service.load(request);
    assert.equal(f.calls.length, 3);
  } finally {
    Date.now = realNow;
  }
});

test("MovieBox artwork is resized before renderer decoding; other and signed URLs stay intact", () => {
  const original = "https://pbcdnw.aoneroom.com/image/2026/10/poster.jpg";
  const resized = new URL(screenPosterUrl(original));
  assert.equal(
    resized.searchParams.get("x-oss-process"),
    "image/resize,w_480,limit_1/quality,q_85/format,webp",
  );
  for (const input of [
    null,
    "data:image/png;base64,abc",
    original + "?signature=secret",
    "https://example.com/image/poster.jpg",
  ])
    assert.equal(screenPosterUrl(input), input);
});

test("Native sources refresh an expired URL on the same server before reducing quality", async () => {
  let calls = 0;
  const f = fixture({
    getStreams: async () => {
      calls++;
      return [
        {
          server: "MovieBox",
          videoSources: [
            {
              url: `https://cdn.example/episode.mp4?token=${calls}`,
              type: "mp4",
              quality: "1080p",
              headers: { Referer: "https://source.example/" },
              subtitles: [
                {
                  id: "en",
                  url: "https://cdn.example/en.srt",
                  language: "en",
                  isDefault: true,
                },
              ],
            },
          ],
        },
      ];
    },
  });
  const opened = await f.service.open(item());
  const locator = opened.queue[0].locator;
  const initial = await resolveRemotePlayback(locator);
  const recovered = await createRemoteRecovery(locator, initial)();
  assert.equal(calls, 2);
  assert.match(recovered.playback.url, /token=2/);
  assert.equal(recovered.lowerQuality, false);
  assert.deepEqual(recovered.playback.subtitles, initial.subtitles);
  assert.deepEqual(
    await resolveRemotePlayback(locator),
    recovered.playback,
    "Warm playback uses refreshed credentials",
  );
});

test("Fractional specials preserve episode identity through the playback queue", async () => {
  const f = fixture({
    getEpisodes: async () => [
      { id: "special-13-5", animeId: "show", number: 13.5, title: "Special" },
    ],
  });
  const opened = await f.service.open(item());
  assert.equal(playbackSourceSchema.parse(opened.queue[0]).episode, 13.5);
  assert.ok(opened.queue[0].progressId);
  assert.equal(opened.queue.length, 1);
});

test("Unchanged native URLs stop recovery and cannot create an infinite refresh loop", async () => {
  let calls = 0;
  const f = fixture({
    getStreams: async () => {
      calls++;
      return [
        {
          server: "KissKH",
          videoSources: [
            {
              url: "https://cdn.example/fixed.mp4",
              type: "mp4",
              quality: "auto",
            },
          ],
        },
      ];
    },
  });
  const opened = await f.service.open(item());
  const locator = opened.queue[0].locator;
  const initial = await resolveRemotePlayback(locator);
  const recovery = await createRemoteRecovery(locator, initial)();
  assert.equal(recovery.retry, undefined);
  assert.ok(calls <= 3);
});

test("Disabling a source during signed-URL refresh aborts recovery", async () => {
  let calls = 0;
  let f;
  f = fixture({
    getStreams: async () => {
      calls++;
      if (calls === 2) f.registry.setEnabled(f.source.id, false);
      return [
        {
          server: "KissKH",
          videoSources: [
            {
              url: `https://cdn.example/video.mp4?token=${calls}`,
              type: "mp4",
              quality: "auto",
            },
          ],
        },
      ];
    },
  });
  const opened = await f.service.open(item());
  const locator = opened.queue[0].locator;
  const initial = await resolveRemotePlayback(locator);
  await assert.rejects(
    createRemoteRecovery(locator, initial),
    /extension changed|disabled|Reload/i,
  );
});

test("An unchanged lower rendition is not misreported as refreshed credentials", async () => {
  const f = fixture({
    getStreams: async () => [
      {
        server: "MovieBox",
        videoSources: [1080, 480].map((height) => ({
          url: `https://cdn.example/fixed-${height}.mp4`,
          type: "mp4",
          quality: `${height}p`,
        })),
      },
    ],
  });
  const opened = await f.service.open(item());
  const locator = opened.queue[0].locator;
  const initial = await resolveRemotePlayback(locator);
  const recovered = await createRemoteRecovery(locator, initial)();
  assert.equal(recovered.lowerQuality, true);
  assert.equal(recovered.retry, undefined);
  assert.match(recovered.playback.url, /480/);
});

function catalogueFixture(overrides = {}) {
  const f = fixture();
  const calls = [];
  const media = (id, kind = "movie") =>
    mediaItemSchema.parse({
      source: "tmdb",
      sourceId: String(id),
      kind,
      title: "Catalogue " + id,
      year: 2020,
      images: {},
      rating: {},
    });
  const catalogue = {
    search: async () => [media(278), media(279)],
    popular: async (_kind, page) => {
      calls.push(page);
      return Array.from({ length: 20 }, (_, index) =>
        media((page - 1) * 20 + index + 1),
      );
    },
    details: async (kind, id) => ({
      ...media(id, kind),
      seasons: [
        { id: "specials", seasonNumber: 0 },
        { id: "one", seasonNumber: 1 },
      ],
      cast: [],
      studios: [],
      countries: [],
      languages: [],
      related: [],
      streaming: [],
      external: {},
    }),
    season: async (_id, seasonNumber) => ({
      id: String(seasonNumber),
      seasonNumber,
      episodes: [
        {
          seasonNumber,
          episodeNumber: 1,
          title: "Aired",
          airDate: "2020-01-01",
        },
        {
          seasonNumber,
          episodeNumber: 2,
          title: "Future",
          airDate: "2100-01-01",
        },
      ],
    }),
    ...overrides,
  };
  const bridgeCalls = [];
  const call = async (method, args) => {
    bridgeCalls.push([method, args]);
    return method === "matchCatalogue" ? args[0] : args[1];
  };
  return {
    ...f,
    media,
    catalogue,
    calls,
    bridgeCalls,
    source: withSourceCatalogue(f.source, call, catalogue),
    call,
  };
}

test("Catalogue-backed sources use canonical IDs and keep credentials in the host", async () => {
  const f = catalogueFixture();
  const rows = await f.source.search("Catalogue", { kind: "movie" });
  assert.deepEqual(
    rows.map((row) => row.id),
    ["movie|278", "movie|279"],
  );
  assert.equal(rows[0].provider, "ext-screen");
  assert.deepEqual(f.bridgeCalls[0], [
    "matchCatalogue",
    [["movie|278", "movie|279"]],
  ]);
  const details = await f.source.catalogueDetails("movie|278");
  assert.equal(details.source, "ext-screen");
  assert.equal(details.sourceId, "movie|278");
  const hostile = withSourceCatalogue(
    f.source,
    async () => ["movie|unrequested"],
    f.catalogue,
  );
  await assert.rejects(
    hostile.search("Catalogue", { kind: "movie" }),
    /invalid catalogue matches/,
  );
});

test("14-item catalogue pages do not discard records from fixed 20-item metadata pages", async () => {
  const f = catalogueFixture();
  const first = await f.source.browse("popular", {
    page: 1,
    limit: 14,
    kind: "movie",
  });
  const second = await f.source.browse("popular", {
    page: 2,
    limit: 14,
    kind: "movie",
  });
  assert.deepEqual(
    [...first.items, ...second.items].map((row) => row.id),
    Array.from({ length: 28 }, (_, index) => "movie|" + (index + 1)),
  );
  assert.deepEqual(f.calls, [1, 2]);
});

test("Catalogue-backed episodes preserve specials and skip future air dates", async () => {
  const f = catalogueFixture();
  const rows = await f.source.getEpisodes("tv|1396");
  assert.deepEqual(
    rows.map((row) => [row.season, row.number]),
    [
      [0, 1],
      [1, 1],
    ],
  );
  assert.equal(rows[0].id, "tv|1396|s0|e1");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    f.source.getEpisodes("tv|1396", { signal: controller.signal }),
  );
  const hostile = withSourceCatalogue(
    f.source,
    async () => [{ id: "forged", animeId: "tv|1396", number: 99 }],
    f.catalogue,
  );
  await assert.rejects(
    hostile.getEpisodes("tv|1396"),
    /invalid catalogue episodes/,
  );
});
