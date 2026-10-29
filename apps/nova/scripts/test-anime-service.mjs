import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-anime-"));
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  stdin: {
    contents: `export { AnimeService } from './apps/nova/electron/anime-service'; export { createStreamSourceProvider } from './packages/extension-host/src/provider'; export { StreamSourceRegistry } from './packages/extension-host/src/stream-registry'; export { resolveRemotePlayback, remoteQualities } from './apps/nova/electron/remote-playback';`,
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "anime.cjs"),
});
const {
  AnimeService,
  createStreamSourceProvider,
  StreamSourceRegistry,
  resolveRemotePlayback,
  remoteQualities,
} = createRequire(import.meta.url)(join(scratch, "anime.cjs"));
function fixture() {
  let streamCalls = 0;
  const source = createStreamSourceProvider({
    extensionId: "fixture",
    name: "Fixture",
    kinds: ["anime"],
    methods: ["search", "getEpisodes", "getStreams"],
    async call(method) {
      if (method === "search")
        return [
          {
            id: "site-title",
            title: "Doupo Cangqiong (Season 1)",
            url: "https://source.example/title",
          },
        ];
      if (method === "getEpisodes")
        return [
          { id: "ep1", animeId: "site-title", number: 1, title: "Episode 1" },
        ];
      streamCalls++;
      return [
        {
          server: "Main",
          headers: { Referer: "https://source.example" },
          videoSources: [
            {
              type: "hls",
              quality: "1080p",
              url: `https://cdn.example/video.m3u8?token=${streamCalls}`,
            },
          ],
        },
      ];
    },
  });
  const registry = new StreamSourceRegistry().register(source);
  return {
    source,
    registry,
    service: new AnimeService(registry),
    calls: () => streamCalls,
  };
}
test("explicit source title selection reaches lazy playable episodes despite catalogue naming differences", async () => {
  const f = fixture();
  const rows = await f.service.search(
    f.source.id,
    "Battle Through the Heavens",
  );
  assert.equal(rows[0].title, "Doupo Cangqiong (Season 1)");
  assert.equal("url" in rows[0], false);
  const result = await f.service.episodes(rows[0].handle);
  assert.equal(result.item.source, f.source.id);
  assert.equal(result.queue.length, 1);
  assert.equal(f.calls(), 0);
  const playback = await resolveRemotePlayback(result.queue[0].locator);
  assert.equal(playback.headers.Referer, "https://source.example");
  assert.match(playback.url, /token=1/);
});
test("disabled or replaced sources invalidate results and pending playback closures", async () => {
  const f = fixture();
  const [title] = await f.service.search(f.source.id, "Battle");
  const { queue } = await f.service.episodes(title.handle);
  f.registry.unregister(f.source.id);
  await assert.rejects(f.service.episodes(title.handle), /changed|disabled/);
  await assert.rejects(
    resolveRemotePlayback(queue[0].locator),
    /changed|disabled/,
  );
  await assert.rejects(
    f.service.episodes("https://arbitrary.example"),
    /expired/,
  );
});
test("opening quality choices cannot evict episode handles from a full queue", async () => {
  const f = fixture();
  const [title] = await f.service.search(f.source.id, "Battle");
  let first;
  for (let i = 0; i < 2000; i++) {
    const { queue } = await f.service.episodes(title.handle);
    first ??= queue[0].locator;
  }
  await remoteQualities(first);
  assert.match((await resolveRemotePlayback(first)).url, /cdn.example/);
});
