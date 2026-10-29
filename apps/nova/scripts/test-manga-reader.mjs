import { build } from "esbuild";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
    worker: join(root, "apps/nova/electron/csharp-worker.ts"),
    progress: join(root, "apps/nova/electron/csharp-manga-progress.ts"),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outdir: scratch,
});
const require = createRequire(import.meta.url);
const { MangaService } = require(join(scratch, "service.js"));
const { NodeDriver } = require(join(scratch, "storage.js"));
const { CSharpProviderSession } = require(join(scratch, "worker.js"));
const { csharpMangaProgress } = require(join(scratch, "progress.js"));
const dll = join(root, "apps/server/bin/Release/net10.0/Vestra.Server.dll");
const sessions = [];
function session(path) {
  const client = new CSharpProviderSession(dll, path);
  sessions.push(client);
  return client;
}
const client = session(join(scratch, "csharp-default"));
after(async () => {
  for (const client of sessions) client.stop();
  await rm(scratch, { recursive: true, force: true });
});
const images = [];
function register(service, id = "manga", backend = client, imageOverride) {
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
      if (imageOverride) return imageOverride(request);
      return { mimeType: "image/png", data: "AAE=" };
    },
    csharpMangaProgress(backend, id),
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
test("progress survives C# worker/service restart, validates bounds and isolates providers", async () => {
  const path = join(scratch, "progress");
  const backend = session(join(scratch, "csharp-restart"));
  const s = new MangaService(new NodeDriver(path));
  register(s, "manga", backend);
  await s.search("manga", "x");
  await s.chapters("manga", "book");
  await s.pages("manga", "book", "chapter");
  await assert.rejects(s.save("manga", "book", "chapter", 2), /Invalid/);
  await s.save("manga", "book", "chapter", 1);
  backend.stop();
  const next = session(join(scratch, "csharp-restart"));
  const restarted = new MangaService(new NodeDriver(path));
  register(restarted, "manga", next);
  register(restarted, "other", next);
  await restarted.search("manga", "x");
  await restarted.search("other", "x");
  assert.equal((await restarted.progress("manga", "book")).page, 1);
  assert.equal(await restarted.progress("other", "book"), null);
  const recent = await restarted.recent("manga");
  assert.equal(recent.entries[0].book.title, "Fixture");
  assert.equal(recent.entries[0].progress.page, 1);
  assert.deepEqual((await restarted.recent("other")).entries, []);
});

test("continue reading grants a saved title without repeating its source search", async () => {
  const backend = session(join(scratch, "csharp-continue"));
  const first = new MangaService(new NodeDriver(join(scratch, "continue")));
  register(first, "manga", backend);
  await first.search("manga", "x");
  await first.chapters("manga", "book");
  await first.pages("manga", "book", "chapter");
  await first.save("manga", "book", "chapter", 1);
  const restarted = new MangaService(new NodeDriver(join(scratch, "continue")));
  register(restarted, "manga", backend);
  assert.equal((await restarted.recent("manga")).entries[0].book.id, "book");
  assert.equal((await restarted.chapters("manga", "book")).length, 1);
  assert.equal((await restarted.progress("manga", "book")).page, 1);
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
    csharpMangaProgress(client, "manga"),
  );
  await assert.rejects(s.image(pages[0].handle));
});
test("disabling or replacing a source rejects its pending image downloads", async () => {
  for (const action of ["disable", "replace"]) {
    const service = new MangaService(new NodeDriver(join(scratch, action)));
    let release;
    register(
      service,
      "manga",
      client,
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await service.search("manga", "x");
    await service.chapters("manga", "book");
    const pages = await service.pages("manga", "book", "chapter");
    const pending = assert.rejects(
      service.image(pages[0].handle),
      /source changed/,
    );
    if (action === "disable") service.unregister("manga");
    else register(service);
    release({ mimeType: "image/png", data: "AAE=" });
    await pending;
  }
});

test("legacy progress imports into C# once and the recovery copy is preserved", async () => {
  const driver = new NodeDriver(join(scratch, "legacy"));
  const backend = session(join(scratch, "csharp-import"));
  const key =
    "manga-progress-" +
    createHash("sha256")
      .update(JSON.stringify(["manga", "book"]))
      .digest("hex")
      .slice(0, 40);
  const legacy = {
    chapterId: "chapter",
    page: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  await driver.write(key, legacy);
  const s = new MangaService(driver);
  register(s, "manga", backend);
  await s.search("manga", "x");
  const imported = await s.progress("manga", "book");
  assert.equal(imported.page, 1);
  assert.equal(Date.parse(imported.updatedAt), Date.parse(legacy.updatedAt));
  await s.chapters("manga", "book");
  await s.pages("manga", "book", "chapter");
  await s.save("manga", "book", "chapter", 0);
  assert.equal((await s.progress("manga", "book")).page, 0);
  assert.deepEqual(await driver.read(key), legacy);
  await driver.remove(key);
  assert.equal((await s.progress("manga", "book")).page, 0);
});
