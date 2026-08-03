import type { z } from "zod";

/**
 * Storage driver contract.
 *
 * Atlas and Nova use the filesystem driver; tests and SSR fallbacks use the
 * in-memory one. Pulse will add its own driver later without touching callers.
 */
export interface StorageDriver {
  read(key: string): Promise<unknown | null>;
  write(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  list(): Promise<string[]>;
}

/**
 * Storage keys become filenames, so they are restricted to a safe charset.
 * This is the guard against path traversal (`../../etc/passwd`).
 */
const SAFE_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key)) {
    throw new Error(
      `Invalid storage key "${key}". Keys must be lowercase alphanumeric with dashes.`,
    );
  }
}

/** In-memory driver — no persistence. Used for tests and as an SSR fallback. */
export class MemoryDriver implements StorageDriver {
  private store = new Map<string, string>();

  async read(key: string): Promise<unknown | null> {
    assertSafeKey(key);
    const raw = this.store.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as unknown);
  }

  async write(key: string, value: unknown): Promise<void> {
    assertSafeKey(key);
    this.store.set(key, JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    assertSafeKey(key);
    this.store.delete(key);
  }

  async list(): Promise<string[]> {
    return [...this.store.keys()];
  }
}

/**
 * Read a document, validate it, and fall back to a default when it is missing
 * or corrupt. A malformed file must never crash the app — Vestra self-heals.
 */
export async function readDocument<T>(
  driver: StorageDriver,
  key: string,
  schema: z.ZodType<T>,
  fallback: T,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await driver.read(key);
  } catch {
    return fallback;
  }

  if (raw === null) return fallback;

  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : fallback;
}

export async function writeDocument<T>(
  driver: StorageDriver,
  key: string,
  schema: z.ZodType<T>,
  value: T,
): Promise<T> {
  // Validate on the way out so corrupt state never reaches disk.
  const parsed = schema.parse(value);
  await driver.write(key, parsed);
  return parsed;
}
