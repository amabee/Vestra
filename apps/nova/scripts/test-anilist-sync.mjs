import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createCipheriv, createDecipheriv } from "node:crypto";
import { test, after } from "node:test";
const directory = await mkdtemp(join(tmpdir(), "vestra-list-sync-"));
after(() => rm(directory, { recursive: true, force: true }));
await build({
  stdin: {
    contents: `export {AniListAccount} from './apps/nova/electron/anilist-account';export {AniListLibrarySync} from './apps/nova/electron/anilist-library-sync';export {applyListChange,appendListChange,fetchListMirror} from './apps/nova/electron/anilist-sync';export {syncStateSchema} from './apps/nova/shared/anilist-sync';export {MemoryDriver,addToWatchlist} from './packages/storage/src/index';`,
    resolveDir: resolve("."),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(directory, "test.cjs"),
});
const {
  AniListAccount,
  AniListLibrarySync,
  applyListChange,
  appendListChange,
  fetchListMirror,
  syncStateSchema,
  MemoryDriver,
  addToWatchlist,
} = createRequire(import.meta.url)(join(directory, "test.cjs"));
const vault = {
  available: () => true,
  encrypt: (text) => {
    const cipher = createCipheriv(
      "aes-256-cbc",
      Buffer.alloc(32, 4),
      Buffer.alloc(16, 2),
    );
    return Buffer.concat([cipher.update(text), cipher.final()]);
  },
  decrypt: (buffer) => {
    const cipher = createDecipheriv(
      "aes-256-cbc",
      Buffer.alloc(32, 4),
      Buffer.alloc(16, 2),
    );
    return Buffer.concat([cipher.update(buffer), cipher.final()]).toString();
  },
};
const token = "fixture-token-for-account-sync";
function remote(id = 42, type = "ANIME", status = "CURRENT", progress = 3) {
  return {
    id: id + 1000,
    mediaId: id,
    status,
    progress,
    updatedAt: 100,
    media: {
      id,
      type,
      title: { english: "A quiet journey", romaji: null, native: null },
      coverImage: { large: "https://images.example/cover.png" },
      episodes: type === "ANIME" ? 12 : null,
      chapters: type === "MANGA" ? 24 : null,
      seasonYear: 2026,
    },
  };
}
function change(overrides = {}) {
  return {
    type: "ANIME",
    mediaId: 42,
    source: "anilist",
    sourceId: "42",
    title: "A quiet journey",
    action: "ensure",
    at: 1,
    ...overrides,
  };
}
function server() {
  const state = {
    user: 1,
    rows: new Map(),
    requests: [],
    fail: 0,
    graphFail: 0,
  };
  const query = async (query, variables = {}) => {
    state.requests.push({ query, variables });
    if (query.includes("VestraViewer"))
      return {
        Viewer: { id: state.user, name: "Reader " + state.user, avatar: null },
      };
    if (query.includes("VestraSyncLists"))
      return {
        Page: {
          pageInfo: { hasNextPage: false },
          mediaList: [...state.rows.values()].filter(
            (row) => row.media.type === variables.type,
          ),
        },
      };
    if (query.includes("VestraSyncEntry"))
      return {
        Media: {
          id: variables.id,
          type: variables.type,
          episodes: 12,
          chapters: 24,
          mediaListEntry: state.rows.get(variables.id) ?? null,
        },
      };
    if (query.includes("VestraSyncSave")) {
      const entry =
        state.rows.get(variables.mediaId) ??
        remote(variables.mediaId, "ANIME", "PLANNING", 0);
      const next = {
        ...entry,
        ...(variables.status ? { status: variables.status } : {}),
        ...(variables.progress !== undefined
          ? { progress: variables.progress }
          : {}),
      };
      state.rows.set(next.mediaId, next);
      return { SaveMediaListEntry: next };
    }
    if (query.includes("VestraSyncRemove")) {
      for (const [id, row] of state.rows)
        if (row.id === variables.id) state.rows.delete(id);
      return { DeleteMediaListEntry: { deleted: true } };
    }
    if (query.includes("VestraSyncMatch")) return { Page: { media: [] } };
    throw Error("Unexpected query");
  };
  const fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (state.before) await state.before(body);
    if (!body.query.includes("VestraViewer") && state.fail)
      return Response.json(
        { private: "must not leak" },
        { status: state.fail, headers: { "retry-after": "60" } },
      );
    if (!body.query.includes("VestraViewer") && state.graphFail)
      return Response.json({
        errors: [{ status: state.graphFail, message: token }],
      });
    return Response.json({ data: await query(body.query, body.variables) });
  };
  return { ...state, state, query, fetch };
}
async function account(name, mock = server()) {
  const folder = join(directory, name);
  let now = 1000000;
  const value = new AniListAccount(
    folder,
    vault,
    mock.fetch,
    () => now,
    async () => {},
  );
  await value.load();
  await value.connect(token);
  return { value, mock, folder, advance: (ms) => (now += ms) };
}
test("new local changes remain visible while a full sync is in flight", async () => {
  const { value, mock, folder } = await account("in-flight");
  mock.state.rows.set(42, remote());
  let release, entered;
  const gate = new Promise((resolve) => (release = resolve)),
    started = new Promise((resolve) => (entered = resolve));
  mock.state.before = async (body) => {
    if (body.query.includes("VestraSyncLists")) {
      entered();
      await gate;
    }
  };
  const work = value.syncLists(true);
  await started;
  const save = value.queueListChange(
    change({ action: "status", status: "PAUSED" }),
  );
  assert.equal(value.status().sync.pending, 1);
  assert.equal(value.listSyncState().pending[0].status, "PAUSED");
  await save;
  const persisted = JSON.parse(
    vault.decrypt(await readFile(join(folder, "anilist-account.enc"))),
  );
  assert.equal(persisted.sync.pending[0].status, "PAUSED");
  release();
  await work;
  await save;
  mock.state.before = null;
  await value.syncLists(true);
  assert.equal(value.status().sync.pending, 0);
  assert.equal(mock.state.rows.get(42).status, "PAUSED");
});
test("disconnect cancels in-flight writes and never transfers work to another account", async () => {
  const { value, mock } = await account("cancel-in-flight");
  await value.queueListChange(change({ action: "status", status: "PAUSED" }));
  let release, entered;
  const gate = new Promise((resolve) => (release = resolve)),
    started = new Promise((resolve) => (entered = resolve));
  mock.state.before = async (body) => {
    if (body.query.includes("VestraSyncEntry")) {
      entered();
      await gate;
    }
  };
  const work = value.syncLists(true);
  await started;
  const disconnected = value.disconnect();
  release();
  await assert.rejects(work, /account changed/);
  await disconnected;
  mock.state.before = null;
  mock.state.user = 2;
  await value.connect(token);
  assert.equal(value.status().sync.pending, 0);
  assert.equal(
    mock.state.requests.some((row) => row.query.includes("VestraSyncSave")),
    false,
  );
});
test("planning/playlist adds preserve existing remote status, progress and unrelated fields", async () => {
  const mock = server();
  mock.state.rows.set(42, remote(42, "ANIME", "COMPLETED", 12));
  const result = await applyListChange(change(), mock.query);
  assert.equal(result.entry.status, "COMPLETED");
  assert.equal(result.entry.progress, 12);
  assert.equal(
    mock.state.requests.some((row) => row.query.includes("mutation")),
    false,
  );
});
test("acknowledging an older write cannot discard a newer edit of the same title", async () => {
  const { value, mock, advance } = await account("concurrent-same-title");
  mock.state.rows.set(42, remote());
  await value.queueListChange(
    change({ action: "status", status: "CURRENT", at: 1 }),
  );
  let release, entered;
  const gate = new Promise((resolve) => (release = resolve)),
    started = new Promise((resolve) => (entered = resolve));
  mock.state.before = async (body) => {
    if (body.query.includes("VestraSyncEntry")) {
      entered();
      await gate;
    }
  };
  const work = value.syncLists(true);
  await started;
  await value.queueListChange(
    change({ action: "status", status: "PAUSED", at: 2 }),
  );
  release();
  await work;
  mock.state.before = null;
  assert.equal(value.listSyncState().pending[0].status, "PAUSED");
  advance(60001);
  await value.syncLists(true);
  assert.equal(mock.state.rows.get(42).status, "PAUSED");
  assert.equal(value.status().sync.pending, 0);
});
test("progress is monotonic, completes at the known total, and removals use list-entry IDs", async () => {
  const mock = server();
  mock.state.rows.set(42, remote(42, "ANIME", "CURRENT", 8));
  await applyListChange(
    change({ action: "progress", progress: 3 }),
    mock.query,
  );
  assert.equal(mock.state.rows.get(42).progress, 8);
  await applyListChange(
    change({ action: "progress", progress: 12 }),
    mock.query,
  );
  assert.equal(mock.state.rows.get(42).status, "COMPLETED");
  const mutation = mock.state.requests.find((row) =>
    row.query.includes("VestraSyncSave"),
  );
  assert.deepEqual(Object.keys(mutation.variables).sort(), [
    "mediaId",
    "progress",
    "status",
  ]);
  await applyListChange(change({ action: "remove" }), mock.query);
  assert.equal(mock.state.rows.size, 0);
  assert.equal(mock.state.requests.at(-1).variables.id, 1042);
});
test("coalescing protects explicit removals/statuses and retains the highest completed chapter", () => {
  let state = syncStateSchema.parse({});
  state = appendListChange(state, change({ action: "progress", progress: 7 }));
  state = appendListChange(state, change({ action: "progress", progress: 2 }));
  assert.equal(state.pending[0].progress, 7);
  state = appendListChange(
    state,
    change({ action: "status", status: "PAUSED" }),
  );
  state = appendListChange(state, change({ action: "progress", progress: 9 }));
  assert.equal(state.pending[0].action, "status");
  assert.equal(state.pending[0].status, "PAUSED");
  state = appendListChange(state, change({ action: "remove" }));
  state = appendListChange(state, change({ action: "progress", progress: 10 }));
  assert.equal(state.pending[0].action, "remove");
});
test("encrypted outbox survives restart, retries failures and imports both media types", async () => {
  const { value, mock, folder, advance } = await account("restart");
  mock.state.rows.set(42, remote());
  mock.state.rows.set(91, remote(91, "MANGA"));
  await value.queueListChange(change({ action: "status", status: "PAUSED" }));
  mock.state.fail = 503;
  await value.syncLists(true);
  assert.equal(value.status().sync.pending, 1);
  assert.match(value.status().sync.lastError, /AniList/);
  const encrypted = await readFile(join(folder, "anilist-account.enc"));
  assert.equal(encrypted.includes(Buffer.from(token)), false);
  assert.equal(encrypted.includes(Buffer.from("quiet journey")), false);
  const restarted = new AniListAccount(
    folder,
    vault,
    mock.fetch,
    () => 2000000,
    async () => {},
  );
  await restarted.load();
  mock.state.fail = 0;
  advance(1000000);
  await restarted.syncLists(true);
  assert.equal(restarted.status().sync.pending, 0);
  assert.equal(restarted.listMirror().length, 2);
  assert.equal(
    restarted.listMirror().find((row) => row.mediaId === 42).status,
    "PAUSED",
  );
});
test("rate limits keep work queued; authorization expiry requires reconnect; account changes discard the old outbox", async () => {
  const { value, mock, advance } = await account("auth");
  await value.queueListChange(change());
  mock.state.fail = 429;
  await value.syncLists(true);
  assert.equal(value.status().sync.pending, 1);
  const calls = mock.state.requests.length;
  await value.syncLists(true);
  assert.equal(mock.state.requests.length, calls);
  advance(60001);
  mock.state.fail = 401;
  await value.syncLists(true);
  assert.equal(value.status().needsReconnect, true);
  assert.equal(value.status().sync.pending, 1);
  mock.state.fail = 0;
  await value.connect(token);
  assert.equal(value.status().sync.pending, 1);
  mock.state.user = 2;
  await value.connect(token);
  assert.equal(value.status().sync.pending, 0);
  assert.equal(value.listMirror().length, 0);
});
test("ambiguous source titles never write; full pulls paginate anime and manga", async () => {
  let mutations = 0;
  const query = async (query, v) => {
    if (query.includes("VestraSyncMatch"))
      return {
        Page: {
          media: [1, 2].map((id) => ({
            id,
            title: { english: "A quiet journey" },
            synonyms: [],
            seasonYear: 2026,
          })),
        },
      };
    mutations++;
    throw Error("Must not mutate");
  };
  assert.equal(
    await applyListChange(
      change({ mediaId: undefined, source: "ext-fixture" }),
      query,
    ),
    null,
  );
  assert.equal(mutations, 0);
  const pages = [];
  const result = await fetchListMirror(async (_q, v) => {
    pages.push([v.type, v.page]);
    return {
      Page: {
        pageInfo: { hasNextPage: v.page < 2 },
        mediaList: [remote((v.type === "ANIME" ? 40 : 90) + v.page, v.type)],
      },
    };
  }, 1);
  assert.equal(result.length, 4);
  assert.deepEqual(pages, [
    ["ANIME", 1],
    ["ANIME", 2],
    ["MANGA", 1],
    ["MANGA", 2],
  ]);
});
test("incoming list status/deletion reflects in local views while unrelated sources survive", async () => {
  const { value, mock } = await account("views");
  mock.state.rows.set(42, remote(42, "ANIME", "PAUSED", 5));
  mock.state.rows.set(91, remote(91, "MANGA"));
  await value.syncLists(true);
  const driver = new MemoryDriver();
  const sync = new AniListLibrarySync(
    value,
    driver,
    () => ({ list: async () => [] }),
    () => {},
  );
  const local = sync.animeList([]);
  assert.equal(local[0].status, "paused");
  await addToWatchlist(driver, local[0].snapshot, "planned");
  const rows = await driver.read("watchlist");
  assert.equal(sync.animeList(rows.entries)[0].status, "paused");
  assert.equal(sync.mangaList().length, 1);
  mock.state.rows.clear();
  await value.syncLists(true);
  assert.equal(sync.animeList(rows.entries).length, 0);
  assert.equal(sync.mangaList().length, 0);
});
