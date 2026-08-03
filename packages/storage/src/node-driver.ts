import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertSafeKey, type StorageDriver } from "./driver";

/**
 * Filesystem JSON driver.
 *
 * Writes are atomic (temp file + rename) and serialised per key, so a crash or
 * two concurrent writers can never leave a half-written document on disk.
 */
export class NodeDriver implements StorageDriver {
  private readonly baseDir: string;
  /** One promise chain per key — the write queue that makes writes serial. */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
  }

  private pathFor(key: string): string {
    assertSafeKey(key);
    const target = path.join(this.baseDir, `${key}.json`);

    // Defence in depth: even with a validated key, confirm the resolved path
    // stays inside the data directory before touching the filesystem.
    const resolved = path.resolve(target);
    if (resolved !== target || !resolved.startsWith(this.baseDir + path.sep)) {
      throw new Error(`Refusing to access path outside the data directory: ${key}`);
    }

    return resolved;
  }

  /** Serialise operations on a key so concurrent writers don't interleave. */
  private enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.locks.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }

  async read(key: string): Promise<unknown | null> {
    const file = this.pathFor(key);

    try {
      const raw = await readFile(file, "utf8");
      return JSON.parse(raw) as unknown;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // A missing file is a normal empty state, not an error.
      if (code === "ENOENT") return null;
      // A corrupt file is recoverable — callers fall back to defaults.
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async write(key: string, value: unknown): Promise<void> {
    const file = this.pathFor(key);

    return this.enqueue(key, async () => {
      await mkdir(this.baseDir, { recursive: true });

      const tempFile = `${file}.${randomUUID()}.tmp`;
      const contents = `${JSON.stringify(value, null, 2)}\n`;

      try {
        await writeFile(tempFile, contents, "utf8");
        // rename is atomic on the same filesystem, so readers see either the
        // old document or the new one — never a partial write.
        await rename(tempFile, file);
      } catch (error) {
        await rm(tempFile, { force: true }).catch(() => undefined);
        throw error;
      }
    });
  }

  async remove(key: string): Promise<void> {
    const file = this.pathFor(key);
    return this.enqueue(key, async () => {
      await rm(file, { force: true });
    });
  }

  async list(): Promise<string[]> {
    try {
      const entries = await readdir(this.baseDir);
      return entries
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -".json".length));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}

/**
 * Resolve where Vestra stores its documents.
 * `VESTRA_DATA_DIR` wins; otherwise `<cwd>/.vestra`.
 * Nova overrides this with the OS app-data directory.
 */
export function resolveDataDir(explicit?: string): string {
  const fromEnv = explicit ?? process.env.VESTRA_DATA_DIR;
  if (fromEnv && fromEnv.trim().length > 0) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), ".vestra");
}

let defaultDriver: NodeDriver | null = null;

/** Process-wide driver, so the per-key write locks are actually shared. */
export function getNodeDriver(): NodeDriver {
  defaultDriver ??= new NodeDriver(resolveDataDir());
  return defaultDriver;
}
