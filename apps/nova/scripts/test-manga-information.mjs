import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
