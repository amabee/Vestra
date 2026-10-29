import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-reader-"));
await build({
  entryPoints: {
    service: join(root, "apps/nova/electron/manga-service.ts"),
    storage: join(root, "packages/storage/src/index.ts"),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outdir: scratch,
});
const require = createRequire(import.meta.url);
const { MangaService } = require(join(scratch, "service.js"));
const { NodeDriver } = require(join(scratch, "storage.js"));
after(() => rm(scratch, { recursive: true, force: true }));
const images = [];
function register(service, id = "manga") {
  service.register(
    id,
    "Fixture",
    async (method) =>
      ({
        search: [
          { id: "book", title: "Fixture", url: "https://secret.example" },
        ],
        findChapters: [
          { id: "chapter", chapter: "1", title: "Chapter 1", index: 0 },
        ],
        findChapterPages: [
          {
            url: "https://images.example/2.png",
            index: 1,
            headers: { Referer: "https://manga.example" },
          },
          {
            url: "https://images.example/1.png",
            index: 0,
            headers: { Referer: "https://manga.example" },
          },
        ],
      })[method],
    async (request) => {
      images.push(request);
      return { mimeType: "image/png", data: "AAE=" };
    },
  );
}
test("search/chapter/page handles preserve headers, hide URLs and reject arbitrary handles", async () => {
  const s = new MangaService(new NodeDriver(join(scratch, "handles")));
  register(s);
  await assert.rejects(s.chapters("manga", "book"), /Search/);
  assert.deepEqual(await s.search("manga", "x"), [
    { id: "book", title: "Fixture" },
  ]);
  await s.chapters("manga", "book");
  const pages = await s.pages("manga", "book", "chapter");
  assert.deepEqual(
    pages.map((p) => p.index),
    [0, 1],
  );
  assert.equal("url" in pages[0], false);
  assert.equal(await s.image(pages[0].handle), "data:image/png;base64,AAE=");
  assert.equal(images[0].url, "https://images.example/1.png");
  assert.equal(images[0].headers.Referer, "https://manga.example");
  await assert.rejects(s.image("https://arbitrary.example"), /expired/);
  s.unregister("manga");
  await assert.rejects(s.image(pages[0].handle), /expired/);
});
test("progress survives service/driver restart, validates bounds and isolates providers", async () => {
  const path = join(scratch, "progress");
  const s = new MangaService(new NodeDriver(path));
  register(s);
  await s.search("manga", "x");
  await s.chapters("manga", "book");
  await s.pages("manga", "book", "chapter");
  await assert.rejects(s.save("manga", "book", "chapter", 2), /Invalid/);
  await s.save("manga", "book", "chapter", 1);
  const restarted = new MangaService(new NodeDriver(path));
  register(restarted);
  register(restarted, "other");
  await restarted.search("manga", "x");
  await restarted.search("other", "x");
  assert.equal((await restarted.progress("manga", "book")).page, 1);
  assert.equal(await restarted.progress("other", "book"), null);
});
test("non-raster results are refused before reaching renderer", async () => {
  const s = new MangaService(new NodeDriver(join(scratch, "mime")));
  register(s);
  await s.search("manga", "x");
  await s.chapters("manga", "book");
  const pages = await s.pages("manga", "book", "chapter");
  s.register(
    "manga",
    "Fixture",
    async () => [],
    async () => ({ mimeType: "image/svg+xml", data: "AAE=" }),
  );
  await assert.rejects(s.image(pages[0].handle));
});
