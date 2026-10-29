import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { MangaArtwork } from "./manga-service";

const lifetime = 7 * 24 * 60 * 60 * 1000;
const image =
  /^data:image\/(?:jpeg|png|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}$/;
/** Cache only cover bytes. Keys include request headers; credentials are never written. */
export class MangaCoverCache {
  private memory = new Map<string, { data: string; expires: number }>();
  private memoryBytes = 0;
  private lastPrune = 0;
  private pruning: Promise<void> | null = null;
  constructor(
    private folder: string,
    private now = Date.now,
    private diskBudget = 128 * 1024 * 1024,
  ) {}
  private key(scope: string, artwork: MangaArtwork) {
    return createHash("sha256")
      .update(
        JSON.stringify([
          scope,
          artwork.url,
          Object.entries(artwork.headers).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        ]),
      )
      .digest("hex");
  }
  private remember(key: string, data: string, expires: number) {
    const old = this.memory.get(key);
    if (old) this.memoryBytes -= old.data.length * 2;
    this.memory.delete(key);
    this.memory.set(key, { data, expires });
    this.memoryBytes += data.length * 2;
    while (this.memoryBytes > 32 * 1024 * 1024 || this.memory.size > 64) {
      const oldest = this.memory.keys().next().value!;
      this.memoryBytes -= this.memory.get(oldest)!.data.length * 2;
      this.memory.delete(oldest);
    }
  }
  async get(scope: string, artwork: MangaArtwork): Promise<string | null> {
    const key = this.key(scope, artwork),
      file = join(this.folder, `${key}.json`);
    const hot = this.memory.get(key);
    if (hot && hot.expires > this.now()) {
      this.remember(key, hot.data, hot.expires);
      return hot.data;
    }
    if (hot) {
      this.memoryBytes -= hot.data.length * 2;
      this.memory.delete(key);
    }
    try {
      if ((await stat(file)).size > 2_800_000)
        throw new Error("Oversized cover cache entry.");
      const value = JSON.parse(await readFile(file, "utf8"));
      if (
        value.version !== 1 ||
        !Number.isFinite(value.expires) ||
        value.expires <= this.now() ||
        typeof value.data !== "string" ||
        !image.test(value.data) ||
        value.data.length > 2_796_260
      )
        throw new Error("Expired or invalid cover cache entry.");
      this.remember(key, value.data, value.expires);
      void utimes(file, new Date(), new Date()).catch(() => undefined);
      return value.data;
    } catch {
      await rm(file, { force: true }).catch(() => undefined);
      return null;
    }
  }
  async put(scope: string, artwork: MangaArtwork, data: string) {
    if (data.length > 2_796_260 || !image.test(data)) return;
    const key = this.key(scope, artwork),
      expires = this.now() + lifetime;
    this.remember(key, data, expires);
    await mkdir(this.folder, { recursive: true });
    const file = join(this.folder, `${key}.json`),
      temporary = join(this.folder, `${key}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify({ version: 1, expires, data }));
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    if (this.now() - this.lastPrune > 60_000) {
      this.lastPrune = this.now();
      this.pruning ??= this.prune().finally(() => {
        this.pruning = null;
      });
      await this.pruning;
    }
  }
  async invalidate(scope: string, artwork: MangaArtwork) {
    const key = this.key(scope, artwork),
      old = this.memory.get(key);
    if (old) this.memoryBytes -= old.data.length * 2;
    this.memory.delete(key);
    await rm(join(this.folder, `${key}.json`), { force: true }).catch(
      () => undefined,
    );
  }
  private async prune() {
    const names = (await readdir(this.folder)).filter((name) =>
      /^[a-f0-9]{64}\.json$/.test(name),
    );
    const files = (
      await Promise.all(
        names.map(async (name) => {
          const file = join(this.folder, name);
          try {
            const value = await stat(file);
            return { file, size: value.size, time: value.mtimeMs };
          } catch {
            return null;
          }
        }),
      )
    )
      .filter((value) => value !== null)
      .sort((a, b) => b.time - a.time);
    let bytes = 0;
    for (const [index, file] of files.entries()) {
      bytes += file.size;
      if (
        bytes > this.diskBudget ||
        index >= 512 ||
        file.time < this.now() - lifetime
      )
        await rm(file.file, { force: true }).catch(() => undefined);
    }
  }
}
