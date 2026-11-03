import { ANILIST_GRAPHQL_ENDPOINT } from "@vestra/config/constants";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { AniListAccountStatus } from "../shared/anilist-account";
import {
  listChangeSchema,
  syncStateSchema,
  type AniListChange,
} from "../shared/anilist-sync";
import {
  appendListChange,
  applyListChange,
  changeKey,
  fetchListMirror,
} from "./anilist-sync";

const tokenSchema = z
  .string()
  .trim()
  .min(16)
  .max(8192)
  .regex(/^[A-Za-z0-9._~-]+$/);
const userSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(200),
  avatar: z.string().url().nullable(),
  url: z.string().url(),
});
const stateSchema = z.object({
  token: tokenSchema.nullable(),
  user: userSchema,
  needsReconnect: z.boolean().default(false),
  lastBackupAt: z.number().nullable().default(null),
  lastBackupError: z.string().nullable().default(null),
  nextBackupAttemptAt: z.number().nullable().default(null),
  sync: syncStateSchema,
});
const groupSchema = z.object({
  name: z.string().nullable(),
  isCustomList: z.boolean().nullable(),
  entries: z
    .array(
      z.object({
        id: z.number().int(),
        mediaId: z.number().int(),
        status: z.string().nullable(),
        score: z.number().nullable(),
        progress: z.number().nullable(),
        progressVolumes: z.number().nullable(),
        repeat: z.number().nullable(),
        priority: z.number().nullable(),
        private: z.boolean().nullable(),
        notes: z.string().nullable(),
        hiddenFromStatusLists: z.boolean().nullable(),
        customLists: z.unknown(),
        advancedScores: z.unknown(),
        startedAt: z.unknown(),
        completedAt: z.unknown(),
        updatedAt: z.number().nullable(),
        media: z.unknown(),
      }),
    )
    .max(1000),
});
const collectionSchema = z.object({
  hasNextChunk: z.boolean(),
  lists: z.array(groupSchema).max(100),
});
const ENTRY_FIELDS = `id mediaId status score(format:POINT_100) progress progressVolumes repeat priority private notes hiddenFromStatusLists customLists advancedScores startedAt { year month day } completedAt { year month day } updatedAt media { id type title { romaji english native } }`;
const BACKUP_QUERY = `query VestraListBackup($userId:Int!,$type:MediaType!,$chunk:Int!) { MediaListCollection(userId:$userId,type:$type,chunk:$chunk,perChunk:500) { hasNextChunk lists { name isCustomList entries { ${ENTRY_FIELDS} } } } }`;
const DAY = 86400000;
class AccountError extends Error {
  constructor(
    message: string,
    public status = 0,
    public retryMs = 15 * 60000,
  ) {
    super(message);
  }
}
export interface AccountVault {
  available(): boolean;
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}
/** Main-process-only service; API failures never echo upstream bodies or tokens. */
export class AniListAccount {
  private state: z.infer<typeof stateSchema> | null = null;
  private loadError = false;
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private controller = new AbortController();
  private backingUp = false;
  private backupCount = 0;
  private backupWork: Promise<AniListAccountStatus> | null = null;
  private syncWork: Promise<AniListAccountStatus> | null = null;
  private queuedChanges = new Map<string, AniListChange>();
  private queueError: string | null = null;
  constructor(
    private directory: string,
    private vault: AccountVault,
    private request: typeof fetch = fetch,
    private now: () => number = Date.now,
    private pace: (signal: AbortSignal) => Promise<unknown> = (signal) =>
      delay(2100, undefined, { signal }),
  ) {}
  private file() {
    return join(this.directory, "anilist-account.enc");
  }
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async atomic(file: string, value: unknown) {
    if (!this.vault.available())
      throw new Error(
        "Secure credential storage is unavailable on this computer.",
      );
    await mkdir(this.directory, { recursive: true });
    const temporary = file + "." + randomUUID() + ".tmp";
    try {
      await writeFile(temporary, this.vault.encrypt(JSON.stringify(value)), {
        mode: 0o600,
      });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  async load() {
    try {
      const encrypted = await readFile(this.file());
      if (!this.vault.available()) throw new Error("Encryption unavailable");
      this.state = stateSchema.parse(JSON.parse(this.vault.decrypt(encrypted)));
      this.backupCount = (await this.backupFiles()).length;
    } catch (error) {
      this.loadError = (error as NodeJS.ErrnoException).code !== "ENOENT";
    }
    return this.status();
  }
  status(): AniListAccountStatus {
    const state = this.state;
    return {
      connected: !!state?.token && !state.needsReconnect,
      user: state?.user ?? null,
      encryptionAvailable: this.vault.available(),
      needsReconnect: state?.needsReconnect ?? false,
      loadError: this.loadError,
      backingUp: this.backingUp,
      lastBackupAt: state?.lastBackupAt ?? null,
      lastBackupError: state?.lastBackupError ?? null,
      nextBackupAttemptAt: state?.nextBackupAttemptAt ?? null,
      backupCount: this.backupCount,
      sync: {
        pending: this.listSyncState().pending.length,
        syncing: !!this.syncWork,
        lastSyncAt: state?.sync.lastSyncAt ?? null,
        lastError: this.queueError ?? state?.sync.lastError ?? null,
        retryAt: state?.sync.retryAt ?? null,
        unmatched: state?.sync.unmatched ?? 0,
      },
    };
  }
  private async query(
    token: string,
    query: string,
    variables: Record<string, unknown> = {},
  ) {
    let response: Response;
    try {
      response = await this.request(ANILIST_GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query, variables }),
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.any([
          this.controller.signal,
          AbortSignal.timeout(20000),
        ]),
      });
    } catch {
      throw new AccountError("AniList could not be reached. Please try again.");
    }
    if (response.status === 401 || response.status === 403)
      throw new AccountError(
        "AniList authorization expired or was revoked. Reconnect your account.",
        response.status,
      );
    if (response.status === 429)
      throw new AccountError(
        "AniList is rate limiting requests. Pending work will retry later.",
        429,
        Math.min(
          3600000,
          Math.max(
            60000,
            Number(response.headers.get("retry-after")) * 1000 || 15 * 60000,
          ),
        ),
      );
    if (!response.ok)
      throw new AccountError(
        "AniList could not complete the request. Please try again.",
        response.status,
      );
    let payload;
    try {
      payload = z
        .object({
          data: z.unknown().optional(),
          errors: z
            .array(z.object({ status: z.number().optional() }))
            .optional(),
        })
        .parse(await response.json());
    } catch {
      throw new AccountError("AniList returned an invalid response.");
    }
    if (payload.errors?.length) {
      const status = payload.errors[0]?.status ?? 0;
      throw new AccountError(
        status === 401 || status === 403
          ? "AniList authorization expired or was revoked. Reconnect your account."
          : "AniList could not complete the request. Please try again.",
        status,
      );
    }
    if (!payload.data)
      throw new AccountError("AniList returned an empty response.");
    return payload.data;
  }
  connect(raw: unknown) {
    const parsedToken = tokenSchema.safeParse(raw);
    if (!parsedToken.success)
      throw new Error("Enter a valid AniList access token without spaces.");
    const token = parsedToken.data;
    const generation = ++this.generation;
    this.queuedChanges.clear();
    this.queueError = null;
    this.controller.abort();
    this.controller = new AbortController();
    return this.enqueue(async () => {
      if (generation !== this.generation)
        throw new Error("Account connection was canceled.");
      if (!this.vault.available())
        throw new Error(
          "Secure credential storage is unavailable on this computer.",
        );
      const data = z
        .object({
          Viewer: z.object({
            id: z.number().int().positive(),
            name: z.string().min(1).max(200),
            avatar: z.object({ large: z.string().url().nullish() }).nullish(),
          }),
        })
        .parse(
          await this.query(
            token,
            "query VestraViewer { Viewer { id name avatar { large } } }",
          ),
        );
      if (generation !== this.generation)
        throw new Error("Account connection was canceled.");
      const next = stateSchema.parse({
        token,
        user: {
          id: data.Viewer.id,
          name: data.Viewer.name,
          avatar: data.Viewer.avatar?.large ?? null,
          url: `https://anilist.co/user/${data.Viewer.id}`,
        },
        ...(this.state?.user.id === data.Viewer.id
          ? { lastBackupAt: this.state.lastBackupAt, sync: this.state.sync }
          : {}),
      });
      const existingBackups = await this.backupFiles(next.user.id);
      if (existingBackups[0]) {
        try {
          const saved = z
            .object({
              format: z.literal("vestra-anilist-backup"),
              version: z.literal(1),
              user: z.object({ id: z.literal(next.user.id) }),
              createdAt: z.number().int().nonnegative(),
            })
            .parse(
              JSON.parse(
                this.vault.decrypt(
                  await readFile(join(this.directory, existingBackups[0])),
                ),
              ),
            );
          next.lastBackupAt = saved.createdAt;
        } catch {
          next.lastBackupError =
            "A previous backup could not be read. Existing backup files were kept.";
        }
      }
      await this.atomic(this.file(), next);
      this.state = next;
      this.loadError = false;
      this.backupCount = existingBackups.length;
      return this.status();
    });
  }
  disconnect() {
    ++this.generation;
    this.queuedChanges.clear();
    this.queueError = null;
    this.controller.abort();
    this.controller = new AbortController();
    return this.enqueue(async () => {
      await rm(this.file(), { force: true });
      this.state = null;
      this.loadError = false;
      this.backupCount = 0;
      return this.status();
    });
  }
  private async backupFiles(userId = this.state?.user.id) {
    if (!userId) return [];
    try {
      const prefix = `anilist-backup-${userId}-`;
      return (await readdir(this.directory))
        .filter(
          (f) =>
            f.startsWith(prefix) &&
            /^anilist-backup-\d+-\d+-[a-f0-9-]+\.enc$/.test(f),
        )
        .sort()
        .reverse();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }
  backup() {
    if (this.backupWork) return this.backupWork;
    this.backingUp = true;
    const generation = this.generation;
    this.backupWork = this.enqueue(async () => {
      if (generation !== this.generation)
        throw new Error("Backup canceled because the account changed.");
      const state = this.state;
      if (!state?.token || state.needsReconnect)
        throw new Error("Connect your AniList account before backing up.");
      if ((state.nextBackupAttemptAt ?? 0) > this.now())
        throw new Error(
          "AniList backup is waiting before retrying. Please try again later.",
        );
      try {
        const collections: Record<string, z.infer<typeof groupSchema>[]> = {};
        for (const type of ["ANIME", "MANGA"]) {
          const groups: z.infer<typeof groupSchema>[] = [];
          let complete = false;
          for (let chunk = 1; chunk <= 100; chunk++) {
            const data = z
              .object({ MediaListCollection: collectionSchema })
              .parse(
                await this.query(state.token, BACKUP_QUERY, {
                  userId: state.user.id,
                  type,
                  chunk,
                }),
              );
            groups.push(...data.MediaListCollection.lists);
            if (!data.MediaListCollection.hasNextChunk) {
              complete = true;
              break;
            }
          }
          if (!complete)
            throw new Error(
              "AniList list exceeds the supported backup size. Previous backups were kept.",
            );
          collections[type] = groups;
        }
        if (generation !== this.generation)
          throw new Error("Backup canceled because the account changed.");
        const createdAt = this.now();
        const snapshot = {
          format: "vestra-anilist-backup",
          version: 1,
          createdAt,
          user: state.user,
          scoreFormat: "POINT_100",
          lists: collections,
        };
        if (Buffer.byteLength(JSON.stringify(snapshot)) > 32 * 1024 * 1024)
          throw new Error(
            "AniList backup exceeds 32 MB. Previous backups were kept.",
          );
        await this.atomic(
          join(
            this.directory,
            `anilist-backup-${state.user.id}-${createdAt}-${randomUUID()}.enc`,
          ),
          snapshot,
        );
        const next = {
          ...state,
          lastBackupAt: createdAt,
          lastBackupError: null,
          nextBackupAttemptAt: null,
        };
        await this.atomic(this.file(), next);
        this.state = next;
        const files = await this.backupFiles();
        for (const file of files.slice(7))
          await rm(join(this.directory, file), { force: true });
        this.backupCount = Math.min(files.length, 7);
        this.backingUp = false;
        return this.status();
      } catch (error) {
        if (generation !== this.generation)
          throw new Error("Backup canceled because the account changed.");
        const expired =
          error instanceof AccountError && [401, 403].includes(error.status);
        const message =
          error instanceof AccountError
            ? error.message
            : "AniList backup failed. Previous successful backups were kept.";
        const next = {
          ...state,
          ...(expired ? { token: null, needsReconnect: true } : {}),
          lastBackupError: message,
          nextBackupAttemptAt: expired
            ? null
            : this.now() +
              (error instanceof AccountError ? error.retryMs : 15 * 60000),
        };
        await this.atomic(this.file(), next);
        this.state = next;
        throw new Error(message);
      }
    }).finally(() => {
      this.backingUp = false;
      this.backupWork = null;
    });
    return this.backupWork;
  }
  async backupIfDue(enabled: boolean) {
    if (
      !enabled ||
      !this.state?.token ||
      this.state.needsReconnect ||
      (this.state.nextBackupAttemptAt ?? 0) > this.now() ||
      (this.state.lastBackupAt !== null &&
        this.now() - this.state.lastBackupAt < DAY)
    )
      return;
    await this.backup();
  }
  listMirror() {
    return this.state?.sync.entries ?? [];
  }
  listSyncState() {
    let sync = this.state?.sync ?? syncStateSchema.parse({});
    for (const change of this.queuedChanges.values()) {
      try {
        sync = appendListChange(sync, change);
      } catch {
        break;
      }
    }
    return sync;
  }
  queueListChange(raw: AniListChange) {
    if (!this.state) return Promise.resolve();
    const change = listChangeSchema.parse(raw);
    change.mediaId ??= this.state.sync.links.find(
      (row) => row.key === changeKey(change),
    )?.mediaId;
    const key = changeKey(change);
    this.queuedChanges.set(key, change);
    const generation = this.generation;
    return this.enqueue(async () => {
      if (generation !== this.generation || !this.state) return;
      const mediaId =
        change.mediaId ??
        this.state.sync.links.find((row) => row.key === changeKey(change))
          ?.mediaId;
      const next = {
        ...this.state,
        sync: appendListChange(this.state.sync, {
          ...change,
          ...(mediaId ? { mediaId } : {}),
        }),
      };
      await this.atomic(this.file(), next);
      this.state = next;
      this.queueError = null;
    })
      .catch((error) => {
        this.queueError =
          "A list change could not be queued. Your local edit was kept. Sync pending changes, then retry the edit.";
        throw error;
      })
      .finally(() => {
        if (this.queuedChanges.get(key) === change)
          this.queuedChanges.delete(key);
      });
  }
  bindListIdentity(
    type: "ANIME" | "MANGA",
    source: string,
    sourceId: string,
    mediaId: number,
  ) {
    const generation = this.generation;
    return this.enqueue(async () => {
      if (!this.state || generation !== this.generation) return;
      const key = changeKey({ type, source, sourceId });
      const sync = {
        ...this.state.sync,
        links: [
          ...this.state.sync.links.filter((row) => row.key !== key),
          { key, mediaId },
        ].slice(-2000),
        pending: this.state.sync.pending.map((row) =>
          changeKey(row) === key ? { ...row, mediaId } : row,
        ),
        retryAt: null,
      };
      const next = { ...this.state, sync };
      await this.atomic(this.file(), next);
      this.state = next;
    });
  }
  /** Network work stays outside the disk lane so new local edits persist immediately. */
  syncLists(force = false) {
    if (this.syncWork) return this.syncWork;
    const generation = this.generation;
    this.syncWork = Promise.resolve()
      .then(async () => {
        await this.queue;
        const state = this.state;
        if (
          !state?.token ||
          state.needsReconnect ||
          generation !== this.generation
        )
          return this.status();
        if ((state.sync.retryAt ?? 0) > this.now()) return this.status();
        if (
          !force &&
          !state.sync.pending.length &&
          this.now() - (state.sync.lastSyncAt ?? 0) < 300000
        )
          return this.status();
        let sync = state.sync;
        const acknowledged = new Map<string, string>();
        const deferred = new Set<string>();
        const current = () => {
          if (generation !== this.generation)
            throw Error("Sync canceled because the account changed.");
        };
        const persist = (expired = false) =>
          this.enqueue(async () => {
            current();
            const live = this.state!;
            const pending = live.sync.pending.filter(
              (row) => acknowledged.get(changeKey(row)) !== JSON.stringify(row),
            );
            // Unmatched titles rotate behind ready work instead of blocking the queue.
            pending.sort(
              (a, b) =>
                Number(deferred.has(changeKey(a))) -
                Number(deferred.has(changeKey(b))),
            );
            const links = new Map(live.sync.links.map((row) => [row.key, row]));
            for (const row of sync.links)
              if (!links.has(row.key)) links.set(row.key, row);
            sync = {
              ...sync,
              pending,
              links: [...links.values()].slice(-2000),
              managed: [
                ...new Set([...sync.managed, ...live.sync.managed]),
              ].slice(-50000),
            };
            const next = {
              ...live,
              sync,
              ...(expired ? { token: null, needsReconnect: true } : {}),
            };
            await this.atomic(this.file(), next);
            current();
            this.state = next;
          });
        const query = async (
          document: string,
          variables?: Record<string, unknown>,
        ) => {
          current();
          await this.pace(this.controller.signal);
          current();
          const data = await this.query(state.token!, document, variables);
          current();
          return data;
        };
        try {
          let unmatched = 0;
          const batch = [...sync.pending]
            .sort(
              (a, b) =>
                Number(
                  !!(
                    b.mediaId ||
                    sync.links.some((row) => row.key === changeKey(b))
                  ),
                ) -
                Number(
                  !!(
                    a.mediaId ||
                    sync.links.some((row) => row.key === changeKey(a))
                  ),
                ),
            )
            .slice(0, 20);
          for (const change of batch) {
            const mediaId =
              change.mediaId ??
              sync.links.find((row) => row.key === changeKey(change))?.mediaId;
            const applied = await applyListChange(
              { ...change, ...(mediaId ? { mediaId } : {}) },
              query,
            );
            if (!applied) {
              unmatched++;
              deferred.add(changeKey(change));
              sync = {
                ...sync,
                pending: [
                  ...sync.pending.filter(
                    (row) => changeKey(row) !== changeKey(change),
                  ),
                  change,
                ],
              };
              await persist();
              continue;
            }
            const key = `${change.type}:${applied.mediaId}`;
            acknowledged.set(changeKey(change), JSON.stringify(change));
            sync = {
              ...sync,
              pending: sync.pending.filter(
                (row) => changeKey(row) !== changeKey(change),
              ),
              entries: sync.entries
                .filter((row) => row.mediaId !== applied.mediaId)
                .concat(applied.entry ? [applied.entry] : []),
              managed: [...new Set([...sync.managed, key])].slice(-50000),
              links: [
                ...sync.links.filter((row) => row.key !== changeKey(change)),
                { key: changeKey(change), mediaId: applied.mediaId },
              ].slice(-2000),
            };
            // Persist each acknowledgement, so a later failure cannot lose remaining work.
            await persist();
          }
          const entries = await fetchListMirror(query, state.user.id);
          sync = {
            ...sync,
            entries,
            managed: [
              ...new Set([
                ...sync.managed,
                ...entries.map((row) => `${row.media.type}:${row.mediaId}`),
              ]),
            ].slice(-50000),
            lastSyncAt: this.now(),
            lastError: null,
            retryAt: sync.pending.length
              ? this.now() + (unmatched ? 300000 : 60000)
              : null,
            unmatched,
          };
          await persist();
        } catch (error) {
          current();
          const expired =
            error instanceof AccountError && [401, 403].includes(error.status);
          sync = {
            ...sync,
            lastError:
              error instanceof AccountError
                ? error.message
                : "AniList sync could not finish. Your local changes and pending updates were kept.",
            retryAt: expired
              ? null
              : this.now() +
                (error instanceof AccountError ? error.retryMs : 60000),
          };
          await persist(expired);
        }
        return this.status();
      })
      .finally(() => {
        this.syncWork = null;
      });
    return this.syncWork;
  }
  exportLatest() {
    return this.enqueue(async () => {
      const file = (await this.backupFiles())[0];
      if (!file || !this.vault.available())
        throw new Error("No readable AniList backup is available.");
      const snapshot = JSON.parse(
        this.vault.decrypt(await readFile(join(this.directory, file))),
      );
      if (
        snapshot.format !== "vestra-anilist-backup" ||
        snapshot.user?.id !== this.state?.user.id
      )
        throw new Error("The saved backup is invalid.");
      return JSON.stringify(snapshot, null, 2);
    });
  }
}
