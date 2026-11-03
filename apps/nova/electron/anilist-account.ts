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
import { z } from "zod";
import type { AniListAccountStatus } from "../shared/anilist-account";

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
  constructor(
    private directory: string,
    private vault: AccountVault,
    private request: typeof fetch = fetch,
    private now: () => number = Date.now,
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
        "AniList is rate limiting requests. Backups will retry later.",
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
          ? { lastBackupAt: this.state.lastBackupAt }
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
