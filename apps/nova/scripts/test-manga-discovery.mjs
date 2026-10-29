import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-manga-discovery-"));
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  entryPoints: {
    discovery: join(nova, "electron/manga-discovery.ts"),
    service: join(nova, "electron/manga-service.ts"),
    storage: join(nova, "../../packages/storage/src/index.ts"),
    worker: join(nova, "electron/csharp-worker.ts"),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outdir: scratch,
});
const require = createRequire(import.meta.url),
  { MangaDiscovery } = require(join(scratch, "discovery.js")),
  { MangaService } = require(join(scratch, "service.js")),
  { MemoryDriver } = require(join(scratch, "storage.js"));
const data = {
  GenreCollection: ["Action", "Fantasy"],
  Page: {
    pageInfo: { hasNextPage: true },
    media: [
      {
        id: 1,
        title: { english: "Popular Tale", romaji: "Tale", native: null },
        coverImage: { medium: "https://images.example/medium.jpg" },
        genres: ["Action"],
        countryOfOrigin: "KR",
        status: "FINISHED",
        averageScore: 85,
      },
    ],
  },
};
test("origin, genre, publication, ordering and page filters reach GraphQL as variables", async () => {
  let variables;
  const catalogue = new MangaDiscovery(
    new MemoryDriver(),
    () => randomUUID(),
    async (value) => {
      variables = value;
      return data;
    },
  );
  const result = await catalogue.browse({
    sort: "score",
    origin: "KR",
    genre: "Action",
    status: "FINISHED",
    page: 3,
  });
  assert.deepEqual(variables, {
    page: 3,
    sort: ["SCORE_DESC", "POPULARITY_DESC"],
    country: "KR",
    genres: ["Action"],
    status: "FINISHED",
  });
  assert.equal(result.items[0].title, "Popular Tale");
  assert.equal(result.items[0].score, 85);
  assert.equal(result.page, 3);
  assert.equal(result.hasNextPage, true);
  assert.match(result.items[0].cover, /^[a-f\d-]{36}$/);
  assert.equal("url" in result.items[0], false);
});
test("catalogue calls deduplicate and cached metadata survives service restart", async () => {
  const driver = new MemoryDriver();
  let calls = 0;
  const request = async (variables) => {
    assert.equal("country" in variables, false);
    assert.equal("genres" in variables, false);
    assert.equal("status" in variables, false);
    calls++;
    return data;
  };
  const first = new MangaDiscovery(driver, () => randomUUID(), request);
  const [one, two] = await Promise.all([first.browse({}), first.browse({})]);
  assert.equal(calls, 1);
  assert.equal(one.items[0].title, two.items[0].title);
  const restart = new MangaDiscovery(driver, () => randomUUID(), request);
  await restart.browse({});
  assert.equal(calls, 1);
});
test("offline fallback is labelled stale and never substitutes another filter result", async () => {
  const driver = new MemoryDriver();
  let now = Date.now();
  const first = new MangaDiscovery(
    driver,
    () => randomUUID(),
    async () => data,
    () => now,
  );
  await first.browse({});
  now += 2 * 60 * 60 * 1000;
  const offline = new MangaDiscovery(
    driver,
    () => randomUUID(),
    async () => {
      throw new Error("offline");
    },
    () => now,
  );
  assert.equal((await offline.browse({})).stale, true);
  await assert.rejects(offline.browse({ origin: "CN" }), /offline/);
  await assert.rejects(offline.browse({ page: 0 }));
  await assert.rejects(offline.browse({ sort: "injected" }));
});
test("catalogue covers use the guarded image path without pretending to be reading providers", async () => {
  const service = new MangaService(new MemoryDriver());
  const requests = [];
  service.registerCatalogueImages(async (request) => {
    requests.push(request);
    return { mimeType: "image/png", data: "AAE=" };
  });
  const catalogue = new MangaDiscovery(
    new MemoryDriver(),
    (id, url) => service.catalogueCover(id, url),
    async () => data,
  );
  const result = await catalogue.browse({});
  assert.deepEqual(service.list(), []);
  assert.equal(
    await service.image(result.items[0].cover),
    "data:image/png;base64,AAE=",
  );
  assert.equal(requests[0].url, "https://images.example/medium.jpg");
  const fresh = await service.refreshCatalogueCover(1);
  assert.notEqual(fresh, result.items[0].cover);
  await assert.rejects(service.image(result.items[0].cover), /expired/);
  await service.image(fresh);
  await assert.rejects(service.refreshCatalogueCover(999), /Reopen/);
});
test("rate-limit cooldown avoids hammering AniList across filter changes", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("", { status: 429, headers: { "Retry-After": "30" } });
  };
  try {
    const catalogue = new MangaDiscovery(new MemoryDriver(), () =>
      randomUUID(),
    );
    await assert.rejects(catalogue.browse({}), /rate limited/);
    await assert.rejects(catalogue.browse({ origin: "KR" }), /rate limited/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
if (process.argv.includes("--live"))
  test("live AniList popular and filtered Korean action titles return valid metadata", async () => {
    const covers = new Map();
    const catalogue = new MangaDiscovery(new MemoryDriver(), (id, url) => {
      covers.set(id, url);
      return randomUUID();
    });
    const popular = await catalogue.browse({});
    assert.ok(popular.items.length);
    console.log(
      JSON.stringify({
        live: "popular",
        count: popular.items.length,
        genres: popular.genres.length,
        covers: popular.items.filter((row) => row.cover).length,
      }),
    );
    const korean = await catalogue.browse({
      origin: "KR",
      genre: "Action",
      status: "FINISHED",
    });
    assert.ok(korean.items.length);
    assert.ok(
      korean.items.every(
        (row) =>
          row.origin === "KR" &&
          row.genres.includes("Action") &&
          row.status === "FINISHED",
      ),
    );
    console.log(
      JSON.stringify({
        live: "Korean Action completed",
        count: korean.items.length,
      }),
    );
    const { CSharpProviderWorker } = require(join(scratch, "worker.js"));
    const worker = new CSharpProviderWorker(
      join(nova, "../server/bin/Release/net10.0/Vestra.Server.dll"),
      join(scratch, "worker-store"),
    );
    try {
      const image = await worker.request({
        kind: "image",
        request: {
          url: covers.get(popular.items[0].id),
          method: "GET",
          headers: {},
        },
      });
      assert.ok(
        ["image/jpeg", "image/png", "image/webp", "image/avif"].includes(
          image.mimeType,
        ),
      );
      console.log(
        JSON.stringify({
          live: "AniList cover through C#",
          mime: image.mimeType,
          bytes: Buffer.from(image.data, "base64").length,
        }),
      );
    } finally {
      worker.stop();
    }
  });
