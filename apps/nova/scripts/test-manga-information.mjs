import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-manga-information-"));
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  entryPoints: {
    details: join(nova, "electron/manga-details.ts"),
    resolver: join(nova, "electron/manga-title-resolver.ts"),
    bookmarks: join(nova, "electron/manga-bookmarks.ts"),
    service: join(nova, "electron/manga-service.ts"),
    worker: join(nova, "electron/csharp-worker.ts"),
    storage: join(nova, "../../packages/storage/src/index.ts"),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outdir: scratch,
});
const require = createRequire(import.meta.url),
  { MangaDetails } = require(join(scratch, "details.js")),
  { MangaTitleResolver } = require(join(scratch, "resolver.js")),
  { MangaService } = require(join(scratch, "service.js")),
  { csharpMangaBookmarks } = require(join(scratch, "bookmarks.js")),
  { CSharpProviderSession } = require(join(scratch, "worker.js")),
  { MemoryDriver } = require(join(scratch, "storage.js"));
const row = {
  id: 42,
  title: { english: "A Quiet Journey", romaji: "Quiet Journey", native: null },
  description: "<b>A real synopsis.</b>",
  coverImage: {
    extraLarge: "https://images.example/large.jpg",
    large: "https://images.example/small.jpg",
  },
  genres: ["Adventure"],
  countryOfOrigin: "JP",
  status: "FINISHED",
  averageScore: 85,
  chapters: 20,
  volumes: 3,
  startDate: { year: 2025 },
};
test("details retain authoritative metadata and high-resolution art across a cache restart", async () => {
  const driver = new MemoryDriver(),
    urls = [];
  let requests = 0;
  const request = async () => {
    requests++;
    return { Media: row };
  };
  const first = new MangaDetails(
    driver,
    (_id, url) => {
      urls.push(url);
      return "opaque";
    },
    request,
  );
  const info = await first.get(42);
  assert.equal(info.title, "A Quiet Journey");
  assert.equal(info.description, "A real synopsis.");
  assert.equal(info.chapters, 20);
  assert.equal(info.cover, "opaque");
  assert.equal(urls[0], row.coverImage.extraLarge);
  const next = new MangaDetails(driver, () => "new-handle", request);
  assert.equal((await next.get(42)).cover, "new-handle");
  assert.equal(requests, 1);
});
test("source information requires a unique exact title match and rejects wrong IDs", async () => {
  const unique = new MangaDetails(
    new MemoryDriver(),
    () => "",
    async () => ({ Page: { media: [row] } }),
  );
  assert.equal((await unique.source("A Quiet Journey")).id, 42);
  const ambiguous = new MangaDetails(
    new MemoryDriver(),
    () => "",
    async () => ({ Page: { media: [row, { ...row, id: 43 }] } }),
  );
  assert.equal(await ambiguous.source("A Quiet Journey"), null);
  const fuzzy = new MangaDetails(
    new MemoryDriver(),
    () => "",
    async () => ({ Page: { media: [row] } }),
  );
  assert.equal(await fuzzy.source("A Different Journey"), null);
  const wrong = new MangaDetails(
    new MemoryDriver(),
    () => "",
    async () => ({ Media: row }),
  );
  await assert.rejects(wrong.get(999), /different manga/);
});
test("series bookmarks survive a C# worker restart and resolve disabled-source removal independently of progress", async () => {
  const directory = join(scratch, "store"),
    dll = join(nova, "../server/bin/Release/net10.0/Vestra.Server.dll");
  let worker = new CSharpProviderSession(dll, directory);
  const setup = (client) => {
    const service = new MangaService(new MemoryDriver());
    service.registerBookmarks(csharpMangaBookmarks(client));
    service.registerCatalogueImages(async () => ({
      mimeType: "image/png",
      data: "AAE=",
    }));
    service.registerCatalogueTitle({
      id: 42,
      title: row.title.english,
      genres: [],
      origin: "JP",
      status: "FINISHED",
      score: 85,
    });
    service.catalogueCover(42, row.coverImage.extraLarge);
    service.register(
      "source",
      "Source",
      async () => [
        {
          id: "book",
          title: "A Quiet Journey",
          image: "https://images.example/source.jpg",
        },
      ],
      async () => ({ mimeType: "image/png", data: "AAE=" }),
      {
        async read() {
          return null;
        },
        async save() {
          throw new Error("Bookmarks must not mark read");
        },
        async recent() {
          return { entries: [], unreadable: 0, truncated: false };
        },
        async import(_id, value) {
          return value;
        },
      },
    );
    return service;
  };
  try {
    const service = setup(worker);
    await service.search("source", "quiet");
    await service.bookmark("source", "source", "book", true);
    await service.bookmark("catalogue", "anilist", "42", true);
    assert.equal((await service.bookmarks()).length, 2);
    worker.stop();
    worker = new CSharpProviderSession(dll, directory);
    const next = setup(worker);
    const saved = await next.bookmarks();
    assert.equal(saved.length, 2);
    assert.ok(saved.every((entry) => entry.book.cover));
    assert.equal("url" in saved[0].book, false);
    assert.equal(
      (await next.resolveBook("source", "book")).title,
      "A Quiet Journey",
    );
    next.unregister("source");
    await next.bookmark("source", "source", "book", false);
    assert.equal((await next.bookmarks()).length, 1);
    await assert.rejects(
      next.bookmark("catalogue", "anilist", "999", true),
      /before bookmarking/,
    );
  } finally {
    worker.stop();
  }
});

const progress = {
  read: async () => null,
  recent: async () => ({ entries: [], unreadable: 0, truncated: false }),
  save: async () => {
    throw new Error("Matching must not mark read");
  },
  import: async (_id, value) => value,
};
function sourceService(
  driver,
  calls,
  rows = [
    {
      id: "provider-id",
      title: "A Quiet Journey",
      image: "https://images.example/provider.jpg",
    },
  ],
) {
  const service = new MangaService(driver);
  for (const provider of ["one", "two"])
    service.register(
      provider,
      provider,
      async (method, args) => {
        calls.push({ provider, method, args });
        return method === "search"
          ? rows.map((row) => ({ ...row, id: provider + ":" + row.id }))
          : [
              {
                id: provider + ":chapter",
                title: "Chapter 1",
                chapter: "1",
                index: 0,
              },
            ];
      },
      async () => ({ mimeType: "image/png", data: "AAE=" }),
      progress,
    );
  return service;
}
test("catalogue mappings persist exact provider IDs, restore grants after restart and isolate selected providers", async () => {
  const driver = new MemoryDriver(),
    calls = [];
  let metadataCalls = 0;
  const information = async () => {
    metadataCalls++;
    return {
      ...row,
      title: "A Quiet Journey",
      titles: ["A Quiet Journey"],
      cover: undefined,
    };
  };
  let service = sourceService(driver, calls);
  let resolver = new MangaTitleResolver(driver, service, information);
  const [first, concurrent] = await Promise.all([
    resolver.catalogue("one", 42),
    resolver.catalogue("one", 42),
  ]);
  assert.equal(first.id, "one:provider-id");
  assert.equal(concurrent.id, first.id);
  assert.ok(first.cover);
  assert.equal(calls.filter((c) => c.method === "search").length, 1);
  assert.equal((await service.chapters("one", first.id))[0].id, "one:chapter");
  assert.equal((await resolver.catalogue("two", 42)).id, "two:provider-id");
  assert.equal(metadataCalls, 2);
  service = sourceService(driver, calls);
  resolver = new MangaTitleResolver(driver, service, async () => {
    throw new Error("Persisted IDs should restore without metadata");
  });
  const restored = await resolver.catalogue("one", 42);
  assert.equal(restored.id, "one:provider-id");
  assert.ok(restored.cover);
  assert.equal((await service.chapters("one", restored.id)).length, 1);
  assert.equal((await driver.read("manga-provider-mappings-v1")).length, 2);
});
test("automatic matching rejects ambiguous/fuzzy titles, retries misses, and uses metadata aliases", async () => {
  const driver = new MemoryDriver(),
    calls = [];
  let service = sourceService(driver, calls, [
    { id: "one", title: "Quiet Journey" },
    { id: "two", title: "Quiet Journey" },
  ]);
  let resolver = new MangaTitleResolver(driver, service, async () => ({
    title: "A Quiet Journey",
    titles: ["Quiet Journey"],
  }));
  await assert.rejects(resolver.catalogue("one", 42), /ambiguous/);
  service = sourceService(driver, calls, [
    { id: "wrong", title: "A Quiet Journey sequel" },
  ]);
  resolver = new MangaTitleResolver(driver, service, async () => ({
    title: "A Quiet Journey",
    titles: ["Quiet Journey"],
  }));
  assert.equal(await resolver.catalogue("one", 42), null);
  service = sourceService(driver, calls, [
    { id: "alias", title: "Quiet Journey" },
  ]);
  resolver = new MangaTitleResolver(driver, service, async () => ({
    title: "A Quiet Journey",
    titles: ["Quiet Journey"],
  }));
  assert.equal((await resolver.catalogue("one", 42)).id, "one:alias");
});
test("stale mappings recover by title and cross-source saved manga uses the library provider", async () => {
  const driver = new MemoryDriver(),
    calls = [];
  let service = sourceService(driver, calls);
  let resolver = new MangaTitleResolver(driver, service, async () => ({
    title: "A Quiet Journey",
    titles: [],
  }));
  await resolver.catalogue("one", 42);
  service = sourceService(driver, calls, [
    { id: "changed-id", title: "A Quiet Journey" },
  ]);
  service.registerBookmarks({
    list: async () => [
      {
        kind: "source",
        source: "removed-source",
        id: "original-id",
        title: "A Quiet Journey",
        savedAt: new Date().toISOString(),
      },
    ],
    set: async () => {},
  });
  resolver = new MangaTitleResolver(driver, service, async () => ({
    title: "A Quiet Journey",
    titles: [],
  }));
  assert.equal((await resolver.catalogue("one", 42)).id, "one:changed-id");
  assert.equal(
    (await resolver.source("two", "removed-source", "original-id")).id,
    "two:changed-id",
  );
  await assert.rejects(resolver.catalogue("missing", 42), /unavailable/);
});
test("replacing a provider during matching cannot persist an obsolete result", async () => {
  const driver = new MemoryDriver(),
    service = new MangaService(driver);
  let release;
  service.register(
    "one",
    "one",
    async () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    async () => ({}),
    progress,
  );
  const resolver = new MangaTitleResolver(driver, service, async () => ({
    title: "A Quiet Journey",
    titles: [],
  }));
  const pending = resolver.catalogue("one", 42);
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  service.unregister("one");
  service.register(
    "one",
    "new",
    async () => [],
    async () => ({}),
    progress,
  );
  release([{ id: "old-id", title: "A Quiet Journey" }]);
  await assert.rejects(pending, /changed/);
  assert.equal(await driver.read("manga-provider-mappings-v1"), null);
});
if (process.argv.includes("--live"))
  test("live manga details resolve the requested ID and full cover", async () => {
    const details = new MangaDetails(new MemoryDriver(), (_id, url) => url);
    const info = await details.get(105398);
    assert.equal(info.id, 105398);
    assert.ok(info.description);
    assert.ok(
      info.cover.includes("/extraLarge/") || info.cover.includes("/large/"),
    );
    console.log(
      JSON.stringify({
        live: "manga-details",
        title: info.title,
        chapters: info.chapters,
        hasSynopsis: !!info.description,
        cover: !!info.cover,
      }),
    );
  });

if (process.argv.includes("--live"))
  test("live catalogue resolves MangaStash IDs and chapters automatically", async () => {
    const worker = new CSharpProviderSession(
      join(nova, "../server/bin/Release/net10.0/Vestra.Server.dll"),
      join(scratch, "live-store"),
    );
    try {
      const source = await readFile(
        join(nova, "../../Seanime-Providers/src/manga/mangastash/provider.js"),
        "utf8",
      );
      await worker.request({
        kind: "load",
        provider: {
          id: "mangastash",
          type: "manga-provider",
          source,
          hosts: ["mangastash.org"],
        },
      });
      const driver = new MemoryDriver(),
        service = new MangaService(driver);
      service.register(
        "mangastash",
        "MangaStash",
        (method, args) =>
          worker.request({
            kind: "call",
            providerId: "mangastash",
            method,
            args,
          }),
        (r) => worker.request({ kind: "image", request: r }),
        progress,
      );
      const details = new MangaDetails(driver, (id, url) =>
        service.catalogueCover(id, url),
      );
      const resolver = new MangaTitleResolver(driver, service, (id) =>
        details.get(id),
      );
      const book = await resolver.catalogue("mangastash", 105398);
      assert.ok(book, "Solo Leveling must match the selected source");
      assert.ok(book.cover);
      const chapters = await service.chapters("mangastash", book.id);
      assert.ok(chapters.length);
      const image = await service.image(book.cover);
      assert.ok(image.startsWith("data:image/"));
      console.log(
        JSON.stringify({
          live: "automatic MangaStash details",
          title: book.title,
          chapters: chapters.length,
          providerCover: true,
        }),
      );
    } finally {
      worker.stop();
    }
  });
