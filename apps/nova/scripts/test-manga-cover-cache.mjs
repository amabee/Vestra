import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-cover-cache-"));
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  entryPoints: {
    cache: join(nova, "electron/manga-cover-cache.ts"),
    service: join(nova, "electron/manga-service.ts"),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outdir: scratch,
});
const require = createRequire(import.meta.url),
  { MangaCoverCache } = require(join(scratch, "cache.js")),
  { MangaService } = require(join(scratch, "service.js"));
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const artwork = {
  url: "https://images.example/cover.png",
  headers: { Referer: "https://source.example/" },
};
test("cover bytes survive restart and isolate provider/request headers", async () => {
  const folder = join(scratch, "restart"),
    cache = new MangaCoverCache(folder);
  await cache.put("one", artwork, png);
  assert.equal(await cache.get("one", artwork), png);
  const cold = new MangaCoverCache(folder);
  assert.equal(await cold.get("one", artwork), png);
  assert.equal(await cold.get("two", artwork), null);
  assert.equal(
    await cold.get("one", {
      ...artwork,
      headers: { Referer: "https://different.example/" },
    }),
    null,
  );
});
test("expired, malformed and oversized cache entries become misses", async () => {
  const folder = join(scratch, "expiry");
  let now = Date.now();
  const cache = new MangaCoverCache(folder, () => now);
  await cache.put("one", artwork, png);
  now += 8 * 24 * 60 * 60 * 1000;
  assert.equal(await cache.get("one", artwork), null);
  now = Date.now();
  await cache.put("one", artwork, png);
  const [file] = await readdir(folder);
  await writeFile(join(folder, file), "{broken");
  assert.equal(
    await new MangaCoverCache(folder, () => now).get("one", artwork),
    null,
  );
  await cache.put("one", artwork, png);
  await writeFile(
    join(folder, (await readdir(folder))[0]),
    "x".repeat(2800001),
  );
  assert.equal(await new MangaCoverCache(folder).get("one", artwork), null);
});
test("disk cache stays within its configured byte budget", async () => {
  const folder = join(scratch, "budget");
  let now = Date.now();
  const cache = new MangaCoverCache(folder, () => now, 400);
  for (let i = 0; i < 5; i++) {
    await cache.put("source", { ...artwork, url: artwork.url + "?" + i }, png);
    now += 61000;
  }
  assert.ok(
    (await readdir(folder)).filter((name) => name.endsWith(".json")).length <=
      2,
  );
});
test("service joins prewarm requests, reuses disk after restart, and retry bypasses old bytes", async () => {
  const folder = join(scratch, "service-cache");
  let downloads = 0;
  const driver = {
    async read() {
      return null;
    },
    async write() {},
    async remove() {},
  };
  const repo = {
    async read() {
      return null;
    },
    async recent() {
      return { entries: [], unreadable: 0, truncated: false };
    },
    async save() {},
    async import(_id, p) {
      return p;
    },
  };
  const register = (service) =>
    service.register(
      "source",
      "Source",
      async () => [
        {
          id: "book",
          title: "Book",
          image: artwork.url,
          imageHeaders: artwork.headers,
        },
      ],
      async () => {
        downloads++;
        return { mimeType: "image/png", data: png.split(",")[1] };
      },
      repo,
    );
  const first = new MangaService(driver, new MangaCoverCache(folder));
  register(first);
  const [book] = await first.search("source", "book");
  assert.equal(await first.image(book.cover), png);
  assert.equal(downloads, 1);
  const next = new MangaService(driver, new MangaCoverCache(folder));
  register(next);
  const [again] = await next.search("source", "book");
  assert.notEqual(again.cover, book.cover);
  assert.equal(await next.image(again.cover), png);
  assert.equal(downloads, 1);
  const refreshed = await next.cover("source", "book", true);
  assert.equal(await next.image(refreshed.cover), png);
  assert.equal(downloads, 2);
  next.unregister("source");
  await assert.rejects(next.image(refreshed.cover), /expired/);
});
