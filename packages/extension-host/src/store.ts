import { createHash } from "node:crypto";

import { STORAGE_KEYS } from "@vestra/config/constants";
import { extensionTypeSchema } from "@vestra/provider-sdk";
import { readDocument, writeDocument, type StorageDriver } from "@vestra/storage";
import { z } from "zod";

import { extensionManifestSchema, extensionPermissionSchema } from "./manifest";
import type { InstalledExtension } from "./install";

/**
 * Persistence for installed community extensions.
 *
 * Records and code are stored apart. Records are small, read constantly, and
 * belong in one document; code is large and is content-addressed, so the
 * storage key IS the integrity claim. Two extensions shipping identical source
 * share one entry, and a corrupted entry cannot be read back as if it were
 * fine — see `readSource`.
 */

const permissionGrantSchema = z.object({
  extensionId: z.string(),
  granted: z.array(extensionPermissionSchema),
  allowedHosts: z.array(z.string()),
  grantedForVersion: z.string(),
  grantedAt: z.string(),
});

const installedExtensionSchema = z.object({
  enabled: z.boolean().optional(),
  id: z.string(),
  name: z.string(),
  version: z.string(),
  type: extensionTypeSchema,
  manifest: extensionManifestSchema,
  grant: permissionGrantSchema,
  integrity: z.string().regex(/^[0-9a-f]{64}$/),
  payloadBytes: z.number().int().nonnegative(),
  manifestURI: z.string(),
  payloadURI: z.string(),
  pinned: z.boolean(),
  registryUrl: z.string(),
  installedAt: z.string(),
  lastVerifiedAt: z.string(),
  driftDetectedAt: z.string().nullable(),
});

const extensionsDocSchema = z.object({
  version: z.literal(1).default(1),
  installed: z.array(installedExtensionSchema).default([]),
});

type ExtensionsDoc = z.infer<typeof extensionsDocSchema>;

const EMPTY_DOC: ExtensionsDoc = { version: 1, installed: [] };

/**
 * Storage key for a payload.
 *
 * Driver keys are restricted to lowercase alphanumerics and dashes with a
 * 64-character ceiling, so the hex digest is truncated to 192 bits — still far
 * past any practical collision, and it keeps the key inside the charset that
 * guards against path traversal.
 */
function sourceKey(integrity: string): string {
  return `ext-src-${integrity.slice(0, 48)}`;
}

export async function listInstalled(driver: StorageDriver): Promise<InstalledExtension[]> {
  const doc = await readDocument(driver, STORAGE_KEYS.extensions, extensionsDocSchema, EMPTY_DOC);
  return doc.installed as InstalledExtension[];
}

export async function getInstalled(
  driver: StorageDriver,
  id: string,
): Promise<InstalledExtension | null> {
  const installed = await listInstalled(driver);
  return installed.find((record) => record.id === id) ?? null;
}

/** Write a record and its code. Replaces any existing record with the same id. */
export async function saveInstalled(
  driver: StorageDriver,
  record: InstalledExtension,
  source: string,
): Promise<InstalledExtension[]> {
  const digest = createHash("sha256").update(source, "utf8").digest("hex");
  if (digest !== record.integrity) {
    throw new Error("Refusing to store extension code that does not match its fingerprint.");
  }

  await driver.write(sourceKey(record.integrity), { source });

  const existing = await listInstalled(driver);
  const installed = [...existing.filter((entry) => entry.id !== record.id), record];

  const saved = await writeDocument(driver, STORAGE_KEYS.extensions, extensionsDocSchema, {
    version: 1,
    installed: installed.map(row => installedExtensionSchema.parse(row)),
  });

  return saved.installed as InstalledExtension[];
}

export async function removeInstalled(
  driver: StorageDriver,
  id: string,
): Promise<InstalledExtension[]> {
  const existing = await listInstalled(driver);
  const target = existing.find((record) => record.id === id);
  const installed = existing.filter((record) => record.id !== id);

  // Only drop the code when nothing else references that hash.
  if (target && !installed.some((record) => record.integrity === target.integrity)) {
    await driver.remove(sourceKey(target.integrity)).catch(() => undefined);
  }

  const saved = await writeDocument(driver, STORAGE_KEYS.extensions, extensionsDocSchema, {
    version: 1,
    installed: installed.map(row => installedExtensionSchema.parse(row)),
  });

  return saved.installed as InstalledExtension[];
}

/**
 * Read stored code, re-verifying the fingerprint.
 *
 * Verification happens on every read, not only at install. The stored bytes
 * live in a plain file in the user's data directory, which anything running as
 * that user can rewrite; checking once at install would leave the window open
 * for the entire life of the install. Returns null rather than throwing so a
 * tampered extension is simply not loaded.
 */
export async function readSource(
  driver: StorageDriver,
  record: InstalledExtension,
): Promise<string | null> {
  const stored = await readDocument(
    driver,
    sourceKey(record.integrity),
    z.object({ source: z.string() }),
    { source: "" },
  );

  if (stored.source.length === 0) return null;

  const digest = createHash("sha256").update(stored.source, "utf8").digest("hex");
  return digest === record.integrity ? stored.source : null;
}

/** Persist enablement beside the existing record without rewriting provider code. */
export async function setInstalledEnabled(
  driver: StorageDriver,
  id: string,
  enabled: boolean,
): Promise<void> {
  const installed = await listInstalled(driver);
  if (!installed.some((row) => row.id === id))
    throw new Error("This extension is no longer installed.");
  await writeDocument(driver, STORAGE_KEYS.extensions, extensionsDocSchema, {
    version: 1,
    installed: installed.map((row) =>
      installedExtensionSchema.parse(row.id === id ? { ...row, enabled } : row),
    ),
  });
}

/** Record that the remote payload has drifted from what was installed. */
export async function markDrift(
  driver: StorageDriver,
  id: string,
  drifted: boolean,
): Promise<InstalledExtension[]> {
  const existing = await listInstalled(driver);
  const now = new Date().toISOString();

  const installed = existing.map((record) =>
    record.id === id
      ? {
          ...record,
          lastVerifiedAt: now,
          driftDetectedAt: drifted ? now : record.driftDetectedAt,
        }
      : record,
  );

  const saved = await writeDocument(driver, STORAGE_KEYS.extensions, extensionsDocSchema, {
    version: 1,
    installed: installed.map(row => installedExtensionSchema.parse(row)),
  });

  return saved.installed as InstalledExtension[];
}
