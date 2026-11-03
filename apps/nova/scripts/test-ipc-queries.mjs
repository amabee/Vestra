import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
const scratch = await mkdtemp(resolve("apps/nova/node_modules/.ipc-queries-"));
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  stdin: {
    contents: `export {createQueryClient} from './apps/nova/renderer/src/lib/query-client';export {onlineManager,QueryClient} from '@tanstack/react-query';export {mangaImageHeaders} from './apps/nova/electron/manga-image-request';`,
    resolveDir: resolve("apps/nova"),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "test.cjs"),
  plugins: [
    {
      name: "root-entry",
      setup(b) {
        b.onResolve({ filter: /^\.\/apps\// }, (args) => ({
          path: resolve(args.path) + ".ts",
        }));
      },
    },
  ],
});
const { createQueryClient, onlineManager, QueryClient, mangaImageHeaders } =
  createRequire(import.meta.url)(join(scratch, "test.cjs"));
test("IPC queries and mutations execute when Chromium reports offline", async () => {
  onlineManager.setOnline(false);
  const client = createQueryClient(),
    defaultClient = new QueryClient();
  client.mount();
  defaultClient.mount();
  try {
    const paused = defaultClient.fetchQuery({
      queryKey: ["paused"],
      queryFn: async () => 1,
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(defaultClient.getQueryState(["paused"]).fetchStatus, "paused");
    assert.equal(
      await client
        .fetchQuery({
          queryKey: ["settings"],
          queryFn: async () => ({ ok: true }),
        })
        .then((row) => row.ok),
      true,
    );
    assert.equal(
      await client
        .fetchQuery({
          queryKey: ["discover"],
          queryFn: async () => ["fixture"],
        })
        .then((rows) => rows.length),
      1,
    );
    const mutation = client
      .getMutationCache()
      .build(client, { mutationFn: async () => "saved" });
    assert.equal(await mutation.execute(), "saved");
    onlineManager.setOnline(true);
    assert.equal(await paused, 1);
  } finally {
    onlineManager.setOnline(true);
    client.unmount();
    defaultClient.unmount();
    client.clear();
    defaultClient.clear();
  }
});
test("image headers preserve provider overrides and only derive safe HTTPS referrers", () => {
  const source = {
    referer: "https://source.example/read/one",
    "user-agent": "source-agent",
    accept: "image/png",
    Authorization: "source-key",
  };
  const headers = mangaImageHeaders(
    source,
    "browser-agent",
    "https://other.example/",
  );
  assert.deepEqual(headers, source);
  assert.deepEqual(source, headers);
  const full = Object.fromEntries(
    Array.from({ length: 32 }, (_, i) => ["X-Header-" + i, "value"]),
  );
  assert.deepEqual(
    mangaImageHeaders(full, "agent", "https://source.example/"),
    full,
  );
  assert.equal(
    mangaImageHeaders({}, undefined, "https://source.example/read#private")
      .Referer,
    "https://source.example/read",
  );
  const defaults = mangaImageHeaders(
    {},
    "browser-agent",
    "https://source.example/read/one",
  );
  assert.equal(defaults["User-Agent"], "browser-agent");
  assert.equal(defaults.Referer, "https://source.example/read/one");
  assert.match(defaults.Accept, /image\/webp/);
  for (const value of [
    "opaque-id",
    "file:///private",
    "https://user:password@source.example/x",
    "https://source.example:8443/x",
  ])
    assert.equal(mangaImageHeaders({}, undefined, value).Referer, undefined);
});
