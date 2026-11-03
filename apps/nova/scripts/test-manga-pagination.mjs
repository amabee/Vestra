import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
const scratch = await mkdtemp(
  resolve("apps/nova/node_modules/.manga-pagination-"),
);
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  stdin: {
    contents: `export {nextMangaPage} from './renderer/src/components/manga/manga-search-results';`,
    resolveDir: resolve("apps/nova"),
  },
  tsconfig: resolve("apps/nova/renderer/tsconfig.json"),
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "test.cjs"),
  plugins: [
    {
      name: "bridge",
      setup(b) {
        b.onResolve({ filter: /^@\/lib\/bridge$/ }, () => ({
          path: "bridge",
          namespace: "fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: "export const bridge={};",
        }));
      },
    },
  ],
});
const { nextMangaPage } = createRequire(import.meta.url)(
  join(scratch, "test.cjs"),
);
test("an 18-result page continues when the provider has more data", () => {
  const page = {
    page: 1,
    hasMore: true,
    items: Array.from({ length: 18 }, (_, i) => ({
      id: String(i),
      title: "Fixture",
    })),
  };
  assert.equal(nextMangaPage(page, [page]), 2);
});
test("legacy providers repeating the first page stop without fabricating more results", () => {
  const first = {
      page: 1,
      hasMore: true,
      items: [{ id: "a", title: "Fixture" }],
    },
    second = { ...first, page: 2 };
  assert.equal(nextMangaPage(second, [first, second]), undefined);
  const third = {
    ...second,
    items: [...second.items, { id: "b", title: "Next" }],
  };
  assert.equal(nextMangaPage(third, [first, third]), 3);
});
test("empty pages and explicit exhaustion stop further requests", () => {
  assert.equal(
    nextMangaPage({ page: 2, hasMore: true, items: [] }, []),
    undefined,
  );
  assert.equal(
    nextMangaPage(
      { page: 3, hasMore: false, items: [{ id: "a", title: "Fixture" }] },
      [],
    ),
    undefined,
  );
});
