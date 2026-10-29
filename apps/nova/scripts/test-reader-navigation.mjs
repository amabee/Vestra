import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-reader-navigation-"));
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  entryPoints: [join(root, "apps/nova/renderer/src/lib/manga-reader.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "reader.cjs"),
});
const {
  adjacentPage,
  visiblePages,
  chapterSequence,
  navigationKey,
  parseReaderOptions,
} = createRequire(import.meta.url)(join(scratch, "reader.cjs"));
test("double pages preserve cover and final odd page without skipping", () => {
  const options = { layout: "double", firstPageAlone: true };
  assert.deepEqual(visiblePages(0, 6, options), [0]);
  assert.deepEqual(visiblePages(2, 6, options), [1, 2]);
  assert.deepEqual(visiblePages(5, 6, options), [5]);
  assert.equal(adjacentPage(0, 6, 1, options), 1);
  assert.equal(adjacentPage(2, 6, 1, options), 3);
  assert.equal(adjacentPage(3, 6, -1, options), 1);
  assert.equal(adjacentPage(5, 6, 1, options), 5);
  assert.deepEqual(
    visiblePages(4, 5, { ...options, firstPageAlone: false }),
    [4],
  );
});
test("RTL reverses arrow navigation while logical pages stay in source order", () => {
  assert.equal(navigationKey("ArrowLeft", "rtl"), 1);
  assert.equal(navigationKey("ArrowRight", "rtl"), -1);
  assert.equal(navigationKey("ArrowRight", "ltr"), 1);
  assert.equal(navigationKey("Space", "ltr"), null);
});

test("single-page navigation clamps chapter boundaries and handles empty chapters", () => {
  const options = { layout: "single", firstPageAlone: true };
  assert.equal(adjacentPage(0, 3, -1, options), 0);
  assert.equal(adjacentPage(2, 3, 1, options), 2);
  assert.deepEqual(visiblePages(99, 3, options), [2]);
  assert.deepEqual(visiblePages(0, 0, options), []);
});
test("chapter filtering respects provider indices and fractional labels", () => {
  const chapters = [
    { id: "b", index: 2, chapter: "1.5", language: "en", scanlator: "A" },
    { id: "a", index: 1, chapter: "1", language: "en", scanlator: "A" },
    { id: "c", index: 0, chapter: "1", language: "fr", scanlator: "B" },
  ];
  assert.deepEqual(
    chapterSequence(chapters, "en", "A").map((c) => c.id),
    ["a", "b"],
  );
  assert.deepEqual(
    chapters.map((c) => c.id),
    ["b", "a", "c"],
  );
});
test("malformed local reader preferences recover and zoom stays bounded", () => {
  assert.equal(parseReaderOptions("{broken").layout, "single");
  assert.equal(parseReaderOptions('{"zoom":999,"direction":"rtl"}').zoom, 200);
  assert.equal(parseReaderOptions('{"zoom":0}').zoom, 50);
  assert.equal(parseReaderOptions('{"zoom":"bad","layout":"bad"}').zoom, 100);
});
