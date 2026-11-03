import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(
  join(root, "apps/nova/node_modules/.anime-discovery-"),
);
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  stdin: {
    contents: `export {AnimeDiscovery} from './apps/nova/electron/anime-discovery';export {AnimeService} from './apps/nova/electron/anime-service';export {StreamSourceRegistry,createStreamSourceProvider} from './packages/extension-host/src/index';`,
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "fixture.cjs"),
});
const {
  AnimeDiscovery,
  AnimeService,
  StreamSourceRegistry,
  createStreamSourceProvider,
} = createRequire(import.meta.url)(join(scratch, "fixture.cjs"));
function source(
  id,
  feeds = true,
  browse = async (_category, options) => ({
    items: [{ id: "title-" + options.page, title: id }],
    hasMore: options.page < 2,
  }),
) {
  return createStreamSourceProvider({
    extensionId: id,
    name: id,
    kinds: ["anime"],
    methods: [
      "search",
      "getEpisodes",
      "getStreams",
      ...(feeds ? ["browse"] : []),
    ],
    ...(feeds ? { browseCategories: ["suggested", "latest"] } : {}),
    call: async (method, args) =>
      method === "browse"
        ? browse(...args)
        : method === "getEpisodes"
          ? [{ id: args[0] + "-ep1", animeId: args[0], number: 1 }]
          : [],
  });
}
function setup(
  provider,
  fetchCatalogue = async () => {
    throw Error("Catalogue must not be called");
  },
) {
  const registry = new StreamSourceRegistry().register(provider);
  const titles = new AnimeService(registry);
  return {
    registry,
    titles,
    service: new AnimeDiscovery(registry, titles, fetchCatalogue),
  };
}
test("native feeds stay isolated, cache by category/page, and open their stable title IDs", async () => {
  let calls = 0;
  const provider = source("a", true, async (_c, options) => {
    calls++;
    return {
      items: [{ id: "title-" + options.page, title: "Native" }],
      hasMore: true,
    };
  });
  const { registry, titles, service } = setup(provider);
  registry.register(
    source("b", true, async () => {
      throw Error("Wrong source");
    }),
  );
  const first = await service.browse(provider.id, {
    category: "latest",
    page: 1,
  });
  assert.equal(first.mode, "source");
  assert.equal(first.items[0].source, provider.id);
  assert.equal(titles.rememberedItem(first.items[0]).sourceId, "title-1");
  assert.equal((await titles.open(first.items[0])).queue[0].episode, 1);
  await service.browse(provider.id, { category: "latest", page: 1 });
  assert.equal(calls, 1);
  await service.browse(provider.id, { category: "latest", page: 2 });
  assert.equal(calls, 2);
  await assert.rejects(
    service.browse(provider.id, { category: "upcoming" }),
    /category/,
  );
  registry.setEnabled(provider.id, false);
  await assert.rejects(
    service.browse(provider.id, { category: "latest" }),
    /unavailable/,
  );
  assert.equal(titles.rememberedItem(first.items[0]), null);
});
test("older sources get labelled catalogue discovery with correct airing/upcoming/release filters", async () => {
  const calls = [];
  const provider = source("old", false);
  const { service } = setup(provider, async (_query, variables) => {
    calls.push(variables);
    return {
      Page: {
        pageInfo: { hasNextPage: true },
        media: [
          {
            id: 123,
            title: { english: "Catalogue" },
            coverImage: null,
            seasonYear: 2026,
          },
        ],
      },
    };
  });
  for (const category of [
    "suggested",
    "ongoing",
    "latest",
    "upcoming",
    "popular",
  ]) {
    const page = await service.browse(provider.id, { category });
    assert.equal(page.mode, "catalogue");
    assert.equal(page.items[0].source, "anilist");
    assert.equal(page.categories.length, 5);
  }
  assert.equal(calls[1].status, "RELEASING");
  assert.equal(calls[2].exclude, "NOT_YET_RELEASED");
  assert.equal(calls[3].status, "NOT_YET_RELEASED");
  assert.deepEqual(calls[4].sort, ["POPULARITY_DESC"]);
});
test("late source and catalogue results are rejected after replacement", async () => {
  for (const native of [true, false]) {
    let release;
    const waiting = new Promise((resolve) => (release = resolve));
    const provider = source("changing", native, async () => {
      await waiting;
      return { items: [], hasMore: false };
    });
    const { registry, service } = setup(provider, async () => {
      await waiting;
      return { Page: { pageInfo: { hasNextPage: false }, media: [] } };
    });
    const pending = service.browse(provider.id, {});
    registry.unregister(provider.id);
    registry.register(source("changing", native));
    release();
    await assert.rejects(pending, /changed/);
  }
});
test("failed feeds can retry and invalid pagination never reaches a source", async () => {
  let calls = 0;
  const provider = source("retry", true, async () => {
    if (++calls === 1) throw Error("Offline");
    return { items: [], hasMore: false };
  });
  const { service } = setup(provider);
  await assert.rejects(service.browse(provider.id, {}), /Offline/);
  assert.equal((await service.browse(provider.id, {})).hasMore, false);
  assert.equal(calls, 2);
  for (const page of [0, 101, 1.5])
    await assert.rejects(service.browse(provider.id, { page }));
  assert.equal(calls, 2);
});

test("catalogue fallback adult visibility uses separate caches and filters marked titles", async () => {
  let adult = false;
  const calls = [],
    provider = source("old", false),
    registry = new StreamSourceRegistry().register(provider),
    titles = new AnimeService(registry);
  const service = new AnimeDiscovery(
    registry,
    titles,
    async (query, variables) => {
      assert.match(query, /isAdult:\$isAdult/);
      calls.push(variables.isAdult);
      return {
        Page: {
          pageInfo: { hasNextPage: false },
          media: [
            { id: 1, title: { english: "General" }, isAdult: false },
            { id: 2, title: { english: "Adult fixture" }, isAdult: true },
          ],
        },
      };
    },
    async () => adult,
  );
  assert.equal((await service.browse(provider.id, {})).items.length, 1);
  adult = true;
  assert.equal((await service.browse(provider.id, {})).items.length, 2);
  adult = false;
  assert.equal((await service.browse(provider.id, {})).items.length, 1);
  assert.deepEqual(calls, [false, undefined]);
});
