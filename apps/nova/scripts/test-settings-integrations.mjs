import assert from "node:assert/strict";
import { build } from "esbuild";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const scratch = await mkdtemp(join(tmpdir(), "vestra-integrations-"));
try {
  await build({
    stdin: {
      contents: `export {AniListAccount} from './apps/nova/electron/anilist-account'; export {ChapterCompletions} from './apps/nova/electron/chapter-completions'; export {AnimeInventories} from './apps/nova/electron/anime-inventories'; export {animeUnwatched} from './apps/nova/shared/media-counts'; export {mediaBannerPresentation} from './apps/nova/shared/media-appearance'; export {MemoryDriver,NodeDriver} from './packages/storage/src/index'; export {DEFAULT_SETTINGS,mediaItemSchema} from './packages/types/src/index';`,
      resolveDir: resolve("."),
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(scratch, "test.cjs"),
  });
  const m = createRequire(import.meta.url)(join(scratch, "test.cjs"));
  let encryption = true,
    now = 1770000000000,
    failure = 0,
    calls = [];
  const secret = "fixture.private.token.value";
  const key = randomBytes(32);
  const vault = {
    available: () => encryption,
    encrypt: (text) => {
      const iv = randomBytes(12),
        c = createCipheriv("aes-256-gcm", key, iv),
        body = Buffer.concat([c.update(text, "utf8"), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]);
    },
    decrypt: (data) => {
      const c = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
      c.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([c.update(data.subarray(28)), c.final()]).toString();
    },
  };
  const group = (type) => ({
    name: "Planning",
    isCustomList: false,
    entries: [
      {
        id: type === "ANIME" ? 1 : 2,
        mediaId: 123,
        status: "PLANNING",
        score: 80,
        progress: 2,
        progressVolumes: null,
        repeat: 0,
        priority: 0,
        private: true,
        notes: "private notes",
        hiddenFromStatusLists: false,
        customLists: {},
        advancedScores: {},
        startedAt: null,
        completedAt: null,
        updatedAt: 123,
        media: { id: 123 },
      },
    ],
  });
  const request = async (url, options) => {
    assert.equal(url, "https://graphql.anilist.co");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers.Authorization, `Bearer ${secret}`);
    const body = JSON.parse(options.body);
    calls.push(body);
    if (body.query.includes("VestraViewer"))
      return Response.json({
        data: {
          Viewer: { id: 7, name: "Fixture viewer", avatar: { large: null } },
        },
      });
    if (failure && body.variables.type === "MANGA")
      return Response.json(
        { errors: [{ message: secret, status: failure }] },
        { status: failure },
      );
    return Response.json({
      data: {
        MediaListCollection: {
          hasNextChunk:
            body.variables.type === "ANIME" && body.variables.chunk === 1,
          lists: [group(body.variables.type)],
        },
      },
    });
  };
  const directory = join(scratch, "account");
  const account = new m.AniListAccount(directory, vault, request, () => now);
  assert.equal((await account.load()).loadError, false);
  await account.backupIfDue(true);
  assert.equal(calls.length, 0);
  await account.connect(secret);
  assert.equal(account.status().connected, true);
  assert.equal(account.status().user.name, "Fixture viewer");
  assert.ok(!JSON.stringify(account.status()).includes(secret));
  const credentialFile = join(directory, "anilist-account.enc");
  assert.ok(!(await readFile(credentialFile)).includes(Buffer.from(secret)));
  const reloaded = new m.AniListAccount(directory, vault, request, () => now);
  await reloaded.load();
  assert.equal(reloaded.status().connected, true);
  assert.equal(calls.length, 1, "Reload does not issue account API calls");
  const backup = account.backup();
  assert.equal(backup, account.backup());
  assert.equal(account.status().backingUp, true);
  await backup;
  assert.equal(account.status().backingUp, false);
  assert.equal(account.status().backupCount, 1);
  const exported = JSON.parse(await account.exportLatest());
  assert.equal(exported.lists.ANIME.length, 2);
  assert.equal(exported.lists.MANGA.length, 1);
  assert.equal(exported.lists.ANIME[0].entries[0].private, true);
  assert.ok(!JSON.stringify(exported).includes(secret));
  for (const file of await readdir(directory)) {
    const disk = await readFile(join(directory, file));
    assert.ok(!disk.includes(Buffer.from(secret)));
    assert.ok(!disk.includes(Buffer.from("private notes")));
  }
  const afterSuccess = calls.length;
  await account.backupIfDue(true);
  await account.backupIfDue(false);
  assert.equal(
    calls.length,
    afterSuccess,
    "Fresh or disabled backups make no API calls",
  );
  now += 86400001;
  await account.backupIfDue(true);
  assert.equal(
    calls.length,
    afterSuccess + 3,
    "Daily backup paginates both collections",
  );
  for (let i = 0; i < 8; i++) {
    now++;
    await account.backup();
  }
  assert.equal(account.status().backupCount, 7);
  assert.equal(
    (await readdir(directory)).filter((f) => f.startsWith("anilist-backup"))
      .length,
    7,
  );
  const beforeFailure = account.status().lastBackupAt;
  failure = 503;
  now++;
  await assert.rejects(account.backup(), /could not complete/);
  assert.equal(account.status().lastBackupAt, beforeFailure);
  assert.equal(account.status().backupCount, 7);
  assert.equal(
    JSON.parse(await account.exportLatest()).createdAt,
    beforeFailure,
  );
  const failedCalls = calls.length;
  await account.backupIfDue(true);
  await assert.rejects(account.backup(), /waiting/);
  assert.equal(calls.length, failedCalls);
  now += 900001;
  failure = 429;
  await assert.rejects(account.backup(), /rate limiting/);
  assert.ok(account.status().nextBackupAttemptAt > now);
  now += 900001;
  failure = 401;
  await assert.rejects(account.backup(), /expired/);
  assert.equal(account.status().needsReconnect, true);
  assert.equal(account.status().connected, false);
  assert.equal(account.status().lastBackupAt, beforeFailure);
  assert.ok(!account.status().lastBackupError.includes(secret));
  const expiredCalls = calls.length;
  now += 86400001;
  await account.backupIfDue(true);
  assert.equal(calls.length, expiredCalls);
  failure = 0;
  await account.connect(secret);
  assert.equal(account.status().needsReconnect, false);
  assert.equal(account.status().backupCount, 7);
  await account.disconnect();
  assert.equal(account.status().connected, false);
  await assert.rejects(readFile(credentialFile), { code: "ENOENT" });
  assert.equal(
    (await readdir(directory)).filter((f) => f.startsWith("anilist-backup"))
      .length,
    7,
  );
  await assert.rejects(account.exportLatest(), /No readable/);
  await account.connect(secret);
  assert.equal(
    account.status().lastBackupAt,
    beforeFailure,
    "Reconnect restores the latest successful backup timestamp",
  );
  await account.disconnect();
  let releaseViewer;
  const slow = new m.AniListAccount(
    join(scratch, "canceled-account"),
    vault,
    async () =>
      new Promise((resolve) => {
        releaseViewer = resolve;
      }),
    () => now,
  );
  const connecting = slow.connect(secret);
  await new Promise((resolve) => setImmediate(resolve));
  const disconnecting = slow.disconnect();
  releaseViewer(
    Response.json({
      data: { Viewer: { id: 7, name: "Canceled", avatar: null } },
    }),
  );
  await assert.rejects(connecting, /canceled/);
  await disconnecting;
  assert.equal(slow.status().connected, false);
  await assert.rejects(
    readFile(join(scratch, "canceled-account", "anilist-account.enc")),
    { code: "ENOENT" },
  );
  encryption = false;
  const beforeUnavailable = calls.length;
  await assert.rejects(account.connect(secret), /Secure credential/);
  assert.equal(calls.length, beforeUnavailable);
  encryption = true;
  await writeFile(credentialFile, "corrupt");
  const corrupt = new m.AniListAccount(directory, vault, request, () => now);
  await corrupt.load();
  assert.equal(corrupt.status().loadError, true);
  assert.equal(corrupt.status().connected, false);

  const driver = new m.NodeDriver(join(scratch, "counts"));
  const chapters = new m.ChapterCompletions(driver);
  await chapters.inventory("source", "book", ["1", "2", "2", "3"], false);
  assert.equal((await chapters.count("source", "book")).unread, 3);
  await Promise.all([
    chapters.complete("source", "book", "2"),
    chapters.complete("source", "book", "3"),
  ]);
  assert.equal((await chapters.count("source", "book")).unread, 1);
  assert.equal(
    (
      await new m.ChapterCompletions(
        new m.NodeDriver(join(scratch, "counts")),
      ).count("source", "book")
    ).unread,
    1,
  );
  await chapters.inventory("source", "book", ["1", "2", "3", "4"], true);
  assert.equal((await chapters.count("source", "book")).unread, 2);
  await chapters.inventory("source", "legacy", ["1", "2", "3"], true);
  assert.equal((await chapters.count("source", "legacy")).unread, null);
  await chapters.complete("source", "legacy", "3");
  assert.equal((await chapters.count("source", "legacy")).unread, null);
  await chapters.markAll("source", "legacy", false);
  assert.equal((await chapters.count("source", "legacy")).unread, 3);
  await chapters.markAll("source", "legacy", true);
  assert.equal((await chapters.count("source", "legacy")).unread, 0);
  assert.equal(await chapters.count("other", "book"), null);
  const item = m.mediaItemSchema.parse({
    source: "anilist",
    kind: "anime",
    sourceId: "123",
    title: "Fixture",
    images: {},
    rating: {},
  });
  const progress = (
    episodeNumber,
    completed = true,
    episodeId = "episode-" + episodeNumber,
    updatedAt = 1,
  ) => ({
    ref: item,
    episodeId,
    episodeNumber,
    completed,
    updatedAt,
    positionSeconds: 100,
    durationSeconds: 100,
    percent: 1,
  });
  const watched = {
    a: progress(1),
    b: progress(1, true, "alternate"),
    c: progress(2, false),
  };
  assert.equal(
    m.animeUnwatched(item, 3, watched),
    2,
    "Duplicate sources do not double-count an episode",
  );
  assert.equal(
    m.animeUnwatched(item, 3, {
      a: progress(1, true, "old", 1),
      b: progress(1, false, "new", 2),
    }),
    3,
  );
  assert.equal(m.animeUnwatched(item, null, watched), null);
  assert.equal(m.animeUnwatched(item, 3, { a: progress(null) }), null);
  const inventory = {
    episodes: [
      { id: "ep1", number: 1, season: 1 },
      { id: "ep1alt", number: 1, season: 1 },
      { id: "special", number: null, season: 1 },
    ],
    updatedAt: now,
    complete: true,
  };
  assert.equal(
    m.animeUnwatched(item, null, { a: progress(1, true, "ep1") }, inventory),
    1,
  );
  assert.equal(
    m.animeUnwatched(item, null, watched, { ...inventory, complete: false }),
    null,
  );
  const inventories = new m.AnimeInventories(driver);
  await inventories.remember({
    item,
    queue: [
      { progressId: "ep1", episode: 1 },
      { progressId: "ep2", episode: 2 },
    ],
  });
  assert.equal(
    (await new m.AnimeInventories(driver).list())["anilist:anime:123:anilist"]
      .episodes.length,
    2,
  );
  for (const available of [true, false])
    for (const glassEffects of [true, false])
      for (const mode of [
        "default",
        "blur-available",
        "dim-unavailable",
        "hide-unavailable",
        "dim",
        "blur",
        "hide",
      ]) {
        const state = m.mediaBannerPresentation(
          {
            ...m.DEFAULT_SETTINGS.appearance,
            mediaBannerAppearance: mode,
            glassEffects,
          },
          available,
        );
        assert.equal(
          state.hidden,
          mode === "hide" || (mode === "hide-unavailable" && !available),
        );
        assert.equal(
          state.blurred,
          glassEffects &&
            (mode === "blur" || (mode === "blur-available" && available)),
        );
        assert.equal(
          state.dimmed,
          mode === "dim" || (mode === "dim-unavailable" && !available),
        );
      }
  console.log(
    "PASS encrypted AniList connection/reload/disconnect, private paginated backups/retention/export, API failures/backoff/expiry, persistent exact completion counts/legacy reconciliation, all banner modes",
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
