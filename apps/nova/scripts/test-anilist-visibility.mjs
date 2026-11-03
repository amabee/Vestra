import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(
  join(root, "apps/nova/node_modules/.adult-visibility-"),
);
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  stdin: {
    contents: `export {searchAnime,getTrendingAnime,getPopularAnime} from './packages/api/src/anilist/client';export {createAnilistProvider} from './packages/providers/src/anilist';`,
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "test.cjs"),
});
const {
  searchAnime,
  getTrendingAnime,
  getPopularAnime,
  createAnilistProvider,
} = createRequire(import.meta.url)(join(scratch, "test.cjs"));
test("AniList search and feeds include both adult and general titles only when enabled", async () => {
  const original = globalThis.fetch,
    calls = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(Object.values(body.variables).includes(null), false);
    assert.match(body.query, /isAdult:\s*\$isAdult/);
    calls.push(body.variables.isAdult);
    return new Response(
      JSON.stringify({
        data: {
          Page: {
            pageInfo: { total: 2, hasNextPage: false },
            media: [
              { id: 1, title: { english: "General fixture" }, isAdult: false },
              { id: 2, title: { english: "Adult fixture" }, isAdult: true },
            ],
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    assert.equal((await searchAnime("fixture")).items.length, 1);
    assert.equal(
      (await searchAnime("fixture", { includeAdult: true })).items.length,
      2,
    );
    for (const feed of [getTrendingAnime, getPopularAnime]) {
      assert.equal((await feed()).length, 1);
      assert.equal((await feed(1, 20, true)).length, 2);
    }
    let adult = false;
    const provider = createAnilistProvider(async () => adult),
      query = { query: "fixture", page: 1, perPage: 20 };
    assert.equal((await provider.search(query)).items.length, 1);
    adult = true;
    assert.equal((await provider.search(query)).items.length, 2);
    assert.equal((await provider.getTrending("anime")).length, 2);
    adult = false;
    assert.equal((await provider.getTrending("anime")).length, 1);
    assert.deepEqual(calls, [
      false,
      undefined,
      false,
      undefined,
      false,
      undefined,
      false,
      undefined,
      undefined,
      false,
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

if (process.argv.includes("--live"))
  test("live AniList returns titles when adult filtering is omitted", async () => {
    const hidden = await searchAnime("One Piece", {
      includeAdult: false,
      perPage: 3,
    });
    const enabled = await searchAnime("One Piece", {
      includeAdult: true,
      perPage: 3,
    });
    assert.ok(hidden.items.length > 0);
    assert.ok(enabled.items.length > 0);
  });
