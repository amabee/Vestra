import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-anime-"));
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  stdin: {
    contents: `export { resolveCataloguePlayback } from './apps/nova/electron/catalogue-playback'; export { createStreamSourceAdapter } from './apps/nova/electron/stream-source-adapter'; export { SourceAdapterRegistry, ProviderRegistry, FULL_HOST } from './packages/provider-sdk/src/index'; export { AnimeService } from './apps/nova/electron/anime-service'; export { createStreamSourceProvider } from './packages/extension-host/src/provider'; export { StreamSourceRegistry } from './packages/extension-host/src/stream-registry'; export { resolveRemotePlayback, remoteQualities, createRemoteRecovery } from './apps/nova/electron/remote-playback';`,
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "anime.cjs"),
});
const {
  resolveCataloguePlayback,
  createStreamSourceAdapter,
  SourceAdapterRegistry,
  ProviderRegistry,
  FULL_HOST,
  AnimeService,
  createStreamSourceProvider,
  StreamSourceRegistry,
  resolveRemotePlayback,
  remoteQualities,
  createRemoteRecovery,
} = createRequire(import.meta.url)(join(scratch, "anime.cjs"));
function fixture() {
  let streamCalls = 0;
  const source = createStreamSourceProvider({
    extensionId: "fixture",
    name: "Fixture",
    kinds: ["anime"],
    methods: ["search", "getEpisodes", "getStreams"],
    async call(method) {
      if (method === "search")
        return [
          {
            id: "site-title",
            title: "Doupo Cangqiong (Season 1)",
            url: "https://source.example/title",
          },
        ];
      if (method === "getEpisodes")
        return [
          { id: "ep1", animeId: "site-title", number: 1, title: "Episode 1" },
        ];
      streamCalls++;
      return [
        {
          server: "Main",
          headers: { Referer: "https://source.example" },
          videoSources: [
            {
              type: "hls",
              quality: "1080p",
              url: `https://cdn.example/video.m3u8?token=${streamCalls}`,
            },
          ],
        },
      ];
    },
  });
  const registry = new StreamSourceRegistry().register(source);
  return {
    source,
    registry,
    service: new AnimeService(registry),
    calls: () => streamCalls,
  };
}
test("explicit source title selection reaches lazy playable episodes despite catalogue naming differences", async () => {
  const f = fixture();
  const rows = await f.service.search(
    f.source.id,
    "Battle Through the Heavens",
  );
  assert.equal(rows[0].title, "Doupo Cangqiong (Season 1)");
  assert.equal("url" in rows[0], false);
  const result = await f.service.episodes(rows[0].handle);
  assert.equal(result.item.source, f.source.id);
  assert.equal(result.queue.length, 1);
  assert.equal(f.calls(), 0);
  const playback = await resolveRemotePlayback(result.queue[0].locator);
  assert.equal(playback.headers.Referer, "https://source.example");
  assert.match(playback.url, /token=1/);
});
test("disabled or replaced sources invalidate results and pending playback closures", async () => {
  const f = fixture();
  const [title] = await f.service.search(f.source.id, "Battle");
  const { queue } = await f.service.episodes(title.handle);
  f.registry.unregister(f.source.id);
  await assert.rejects(f.service.episodes(title.handle), /changed|disabled/);
  await assert.rejects(
    resolveRemotePlayback(queue[0].locator),
    /changed|disabled/,
  );
  await assert.rejects(
    f.service.episodes("https://arbitrary.example"),
    /expired/,
  );
});

test("cached stream and quality results still reject removed providers", async () => {
  const f = fixture();
  const [title] = await f.service.search(f.source.id, "Battle");
  const { queue } = await f.service.episodes(title.handle);
  const qualities = await remoteQualities(queue[0].locator);
  await resolveRemotePlayback(qualities[0].locator);
  assert.equal(f.calls(), 1, "quality list and playback share extraction");
  f.registry.unregister(f.source.id);
  await assert.rejects(
    resolveRemotePlayback(queue[0].locator),
    /changed|disabled/,
  );
  await assert.rejects(
    resolveRemotePlayback(qualities[0].locator),
    /changed|disabled/,
  );
});

test("cached searches issue fresh handles after eviction and provider replacement", async () => {
  const f = fixture();
  const [first] = await f.service.search(f.source.id, "Battle");
  for (let i = 0; i < 101; i++)
    await f.service.search(f.source.id, `title ${i}`);
  await assert.rejects(f.service.episodes(first.handle), /expired/);
  const [fresh] = await f.service.search(f.source.id, "Battle");
  assert.notEqual(fresh.handle, first.handle);
  assert.equal((await f.service.episodes(fresh.handle)).queue.length, 1);
  const replacement = fixture().source;
  f.registry.unregister(f.source.id);
  f.registry.register(replacement);
  const [replaced] = await f.service.search(replacement.id, "Battle");
  assert.equal((await f.service.episodes(replaced.handle)).queue.length, 1);
});
test("opening quality choices cannot evict episode handles from a full queue", async () => {
  const f = fixture();
  const [title] = await f.service.search(f.source.id, "Battle");
  let first;
  for (let i = 0; i < 2000; i++) {
    const { queue } = await f.service.episodes(title.handle);
    first ??= queue[0].locator;
  }
  await remoteQualities(first);
  assert.match((await resolveRemotePlayback(first)).url, /cdn.example/);
});

function catalogueFixture() {
  const f = fixture();
  const ref = { source: "anilist", kind: "anime", sourceId: "123" };
  const item = {
    ...ref,
    title: "Battle Through the Heavens",
    originalTitle: "Doupo Cangqiong (Season 1)",
    images: {},
    rating: {},
    isSeries: true,
  };
  const providers = new ProviderRegistry(FULL_HOST).register({
    id: "anilist",
    name: "AniList",
    kinds: ["anime"],
    capabilities: { details: true },
    isAvailable: () => true,
    getDetails: async () => item,
  });
  const adapters = new SourceAdapterRegistry(FULL_HOST).register(
    createStreamSourceAdapter(
      f.source,
      () =>
        f.registry.get(f.source.id) === f.source &&
        f.registry.isEnabled(f.source.id),
    ),
  );
  return { ...f, ref, item, providers, adapters };
}

test("details built-in source discovery never searches streaming extensions", async () => {
  const f = catalogueFixture();
  let searched = false;
  f.adapters.register({
    id: "ext-stream-slow",
    name: "Slow",
    isAvailable: () => true,
    canHandle: () => true,
    resolve: async () => {
      searched = true;
      throw Error("Must not run");
    },
  });
  f.adapters.register({
    id: "local",
    name: "Local",
    isAvailable: () => true,
    canHandle: () => true,
    resolve: async () => [
      { kind: "file", locator: "owned.mp4", priority: 100, mimeType: null },
    ],
  });
  const queue = await resolveCataloguePlayback(
    f.providers,
    f.adapters,
    f.registry,
    f.ref,
    "builtin",
  );
  assert.equal(searched, false);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].kind, "file");
});
test("a catalogue reference is enriched before matching the selected provider and preserves local sources", async () => {
  const f = catalogueFixture();
  let unrelatedCalls = 0;
  f.adapters.register({
    id: "ext-stream-other",
    name: "Other",
    isAvailable: () => true,
    canHandle: () => true,
    resolve: async () => {
      unrelatedCalls++;
      return [];
    },
  });
  f.adapters.register({
    id: "local",
    name: "Local",
    isAvailable: () => true,
    canHandle: () => true,
    resolve: async () => [
      { kind: "file", locator: "owned.mp4", priority: 100, mimeType: null },
    ],
  });
  const queue = await resolveCataloguePlayback(
    f.providers,
    f.adapters,
    f.registry,
    f.ref,
    f.source.id,
  );
  assert.equal(unrelatedCalls, 0);
  assert.equal(queue.length, 2);
  assert.equal(queue[0].kind, "file");
  assert.equal(queue[1].episode, 1);
  assert.equal(f.calls(), 0, "stream resolution remains lazy");
  const playback = await resolveRemotePlayback(queue[1].locator);
  assert.equal(playback.headers.Referer, "https://source.example");
});
test("selected sources cannot silently fall back after disable or missing metadata", async () => {
  const f = catalogueFixture();
  f.registry.setEnabled(f.source.id, false);
  await assert.rejects(
    resolveCataloguePlayback(
      f.providers,
      f.adapters,
      f.registry,
      f.ref,
      f.source.id,
    ),
    /unavailable/,
  );
  f.registry.setEnabled(f.source.id, true);
  f.providers.unregister("anilist");
  await assert.rejects(
    resolveCataloguePlayback(
      f.providers,
      f.adapters,
      f.registry,
      f.ref,
      f.source.id,
    ),
    /information/,
  );
  assert.deepEqual(
    await resolveCataloguePlayback(f.providers, f.adapters, f.registry, f.ref),
    [],
  );
});
test("catalogue episode handles stop working after source removal", async () => {
  const f = catalogueFixture();
  const queue = await resolveCataloguePlayback(
    f.providers,
    f.adapters,
    f.registry,
    f.ref,
    f.source.id,
  );
  f.registry.unregister(f.source.id);
  await assert.rejects(
    resolveRemotePlayback(queue[0].locator),
    /changed|disabled/,
  );
  assert.equal(f.calls(), 0);
  await assert.rejects(
    f.adapters.all()[0].resolve(f.item, {}),
    /changed|disabled/,
  );
});

test("in-flight catalogue search, episode and stream results are rejected after source replacement", async () => {
  for (const stage of ["search", "getEpisodes", "getStreams"]) {
    const f = catalogueFixture();
    const original = f.source[stage];
    f.source[stage] = async (...args) => {
      const result = await original(...args);
      f.registry.unregister(f.source.id);
      return result;
    };
    const adapter = f.adapters.all()[0];
    if (stage !== "getStreams")
      await assert.rejects(adapter.resolve(f.item, {}), /changed|disabled/);
    else {
      const queue = await adapter.resolve(f.item, {});
      await assert.rejects(
        resolveRemotePlayback(queue[0].locator),
        /changed|disabled/,
      );
    }
  }
});
test("catalogue matches reject ambiguous editions while tolerating duplicate rows of the same source ID", async () => {
  const f = catalogueFixture();
  const candidate = {
    id: "a",
    title: f.item.originalTitle,
    provider: f.source.id,
  };
  f.source.search = async () => [candidate, { ...candidate, id: "b" }];
  await assert.rejects(
    f.adapters.all()[0].resolve(f.item, {}),
    /Multiple source editions/,
  );
  f.source.search = async () => [candidate, { ...candidate }];
  assert.equal((await f.adapters.all()[0].resolve(f.item, {})).length, 1);
});

test("a selected provider failure is visible while working local playback remains usable", async () => {
  const f = catalogueFixture();
  f.source.search = async () => {
    throw new Error("Provider timed out");
  };
  await assert.rejects(
    resolveCataloguePlayback(
      f.providers,
      f.adapters,
      f.registry,
      f.ref,
      f.source.id,
    ),
    /Provider timed out/,
  );
  f.adapters.register({
    id: "local",
    name: "Local",
    isAvailable: () => true,
    canHandle: () => true,
    resolve: async () => [
      { kind: "file", locator: "owned.mp4", priority: 100, mimeType: null },
    ],
  });
  assert.equal(
    (
      await resolveCataloguePlayback(
        f.providers,
        f.adapters,
        f.registry,
        f.ref,
        f.source.id,
      )
    )[0].kind,
    "file",
  );
});

test("details resolution returns provider metadata with catalogue identity and stable episode progress IDs", async () => {
  const f = catalogueFixture();
  const first = await f.service.resolve(f.source.id, f.item);
  const second = await f.service.resolve(f.source.id, f.item);
  assert.equal(first.item.sourceId, f.item.sourceId);
  assert.equal(first.providerTitle, "Doupo Cangqiong (Season 1)");
  assert.match(first.queue[0].progressId, /^stream-[a-f0-9]{64}$/);
  assert.equal(first.queue[0].progressId, second.queue[0].progressId);
  assert.notEqual(first.queue[0].locator, second.queue[0].locator);
  assert.equal(f.calls(), 0);
  f.registry.setEnabled(f.source.id, false);
  await assert.rejects(
    f.service.resolve(f.source.id, f.item),
    /disabled|unavailable/,
  );
});

test("episode recovery forwards mirror exclusions through the provider adapter without changing episode identity", async () => {
  const requests = [];
  const source = createStreamSourceProvider({
    extensionId: "mirrors",
    name: "Mirrors",
    kinds: ["anime"],
    methods: ["search", "getEpisodes", "getStreams"],
    async call(method, args) {
      if (method === "search") return [{ id: "title", title: "Fixture" }];
      if (method === "getEpisodes")
        return [
          {
            id: "episode-five",
            animeId: "title",
            number: 5,
            title: "Episode 5",
          },
        ];
      requests.push(args);
      const server = args[1]?.excludeServers?.includes("One") ? "Two" : "One";
      return [
        {
          server,
          headers: { Referer: `https://${server.toLowerCase()}.example` },
          videoSources: [
            {
              type: "hls",
              quality: "1080p",
              url: `https://cdn.example/${server}.m3u8`,
            },
          ],
        },
      ];
    },
  });
  const registry = new StreamSourceRegistry().register(source);
  const service = new AnimeService(registry);
  const [title] = await service.search(source.id, "Fixture");
  const { queue } = await service.episodes(title.handle);
  const before = JSON.stringify(queue);
  const initial = await resolveRemotePlayback(queue[0].locator);
  const recovery = createRemoteRecovery(queue[0].locator, initial);
  const next = await recovery();
  assert.match(next.playback.url, /Two/);
  assert.equal(next.lowerQuality, false);
  assert.equal(requests[0][0], "episode-five");
  assert.equal(requests[1][0], "episode-five");
  assert.deepEqual(requests[1][1], { excludeServers: ["One"] });
  assert.equal(
    JSON.stringify(queue),
    before,
    "progress and queue identities stay stable",
  );
  registry.unregister(source.id);
  await assert.rejects(next.retry(), /changed|disabled/);
});

test("saved source titles reopen after service restart without opaque search handles", async () => {
  const f = fixture();
  const [title] = await f.service.search(f.source.id, "Battle");
  const first = await f.service.episodes(title.handle);
  const restarted = new AnimeService(f.registry);
  const result = await restarted.open(first.item);
  assert.equal(result.item.sourceId, first.item.sourceId);
  assert.equal(result.item.title, first.item.title);
  assert.equal(result.queue[0].progressId, first.queue[0].progressId);
  f.registry.setEnabled(f.source.id, false);
  await assert.rejects(restarted.open(first.item), /disabled|unavailable/);
});

test("source results can be saved as stable metadata without fetching episodes or video", async () => {
  let episodeCalls = 0;
  const source = createStreamSourceProvider({
    extensionId: "save-only",
    name: "Save only",
    kinds: ["anime"],
    methods: ["search", "getEpisodes", "getStreams"],
    async call(method) {
      if (method === "search")
        return [
          {
            id: "persistent-id",
            title: "Save me",
            cover: "https://covers.example/poster.jpg",
          },
        ];
      episodeCalls++;
      throw Error("Saving must not load episodes");
    },
  });
  const service = new AnimeService(new StreamSourceRegistry().register(source));
  const [row] = await service.search(source.id, "Save me");
  const saved = service.title(row.handle);
  assert.equal(saved.sourceId, "persistent-id");
  assert.equal(saved.images.poster, "https://covers.example/poster.jpg");
  assert.equal(episodeCalls, 0);
});
