import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-playlists-"));
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  stdin: {
    contents: `export {AnimePlaylists} from './apps/nova/electron/anime-playlists'; export {NodeDriver} from './packages/storage/src/node-driver'; export {mediaItemSchema,mediaKey} from './packages/types/src/index'; export {animeResume} from './apps/nova/renderer/src/components/media/anime-actions';`,
    resolveDir: root,
  },
  tsconfig: join(root, "apps/nova/renderer/tsconfig.json"),
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "test.cjs"),
});
const { AnimePlaylists, NodeDriver, mediaItemSchema, mediaKey, animeResume } =
  createRequire(import.meta.url)(join(scratch, "test.cjs"));
const item = (id) =>
  mediaItemSchema.parse({
    source: "anilist",
    kind: "anime",
    sourceId: id,
    title: `Anime ${id}`,
    images: {},
    rating: {},
  });
test("named playlists persist through restart and serialize concurrent adds", async () => {
  const driver = new NodeDriver(join(scratch, "persist"));
  const service = new AnimePlaylists(() => driver);
  const [list] = await service.mutate({
    action: "create",
    name: "Weekend anime",
  });
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      service.mutate({
        action: "add",
        id: list.id,
        entry: { item: item(String(i)), provider: "ext-test" },
      }),
    ),
  );
  const reopened = new AnimePlaylists(
    () => new NodeDriver(join(scratch, "persist")),
  );
  assert.equal((await reopened.list())[0].items.length, 12);
  await reopened.mutate({
    action: "add",
    id: list.id,
    entry: { item: item("0"), provider: "ext-new" },
  });
  let current = (await reopened.list())[0];
  assert.equal(current.items.length, 12);
  assert.equal(current.items[0].provider, "ext-new");
  await reopened.mutate({
    action: "move",
    id: list.id,
    key: mediaKey(item("0")),
    to: 11,
  });
  current = (await reopened.list())[0];
  assert.equal(current.items.at(-1).item.sourceId, "0");
  await reopened.mutate({ action: "rename", id: list.id, name: "My weekend" });
  await reopened.mutate({
    action: "remove",
    id: list.id,
    key: mediaKey(item("0")),
  });
  current = (await reopened.list())[0];
  assert.equal(current.name, "My weekend");
  assert.equal(current.items.length, 11);
  assert.deepEqual(
    await driver.list(),
    ["anime-playlists-v1"],
    "existing Watch later data uses a separate repository",
  );
  await reopened.mutate({ action: "delete", id: list.id });
  assert.deepEqual(await reopened.list(), []);
});
test("saving needs no enabled provider and invalid commands cannot alter persistence", async () => {
  const driver = new NodeDriver(join(scratch, "validation"));
  const service = new AnimePlaylists(() => driver);
  const [list] = await service.mutate({ action: "create", name: "Later" });
  await service.mutate({
    action: "add",
    id: list.id,
    entry: { item: item("1"), provider: "" },
  });
  const before = JSON.stringify(await service.list());
  assert.throws(() =>
    service.mutate({ action: "rename", id: list.id, name: "   " }),
  );
  assert.throws(() =>
    service.mutate({
      action: "add",
      id: list.id,
      entry: { item: { ...item("2"), kind: "movie" }, provider: "" },
    }),
  );
  await assert.rejects(
    service.mutate({ action: "remove", id: list.id, key: "missing" }),
    /no longer/,
  );
  assert.equal(JSON.stringify(await service.list()), before);
  await service.mutate({ action: "rename", id: list.id, name: "Still usable" });
  assert.equal((await service.list())[0].name, "Still usable");
});
test("direct play resumes the latest partial episode and otherwise finds the first unwatched", () => {
  const anime = item("3");
  const queue = [1, 2, 3].map((n) => ({ progressId: `ep${n}` }));
  const progress = {
    [`${mediaKey(anime)}#ep1`]: {
      completed: true,
      percent: 1,
      positionSeconds: 1400,
      updatedAt: 30,
    },
    [`${mediaKey(anime)}#ep2`]: {
      completed: false,
      percent: 0.3,
      positionSeconds: 420,
      updatedAt: 20,
    },
    [`${mediaKey(anime)}#ep3`]: {
      completed: false,
      percent: 0.4,
      positionSeconds: 560,
      updatedAt: 40,
    },
  };
  assert.deepEqual(animeResume(anime, queue, progress), {
    index: 2,
    startAt: 560,
  });
  delete progress[`${mediaKey(anime)}#ep2`];
  delete progress[`${mediaKey(anime)}#ep3`];
  assert.deepEqual(animeResume(anime, queue, progress), {
    index: 1,
    startAt: 0,
  });
  assert.deepEqual(animeResume(anime, queue, {}), { index: 0, startAt: 0 });
});
