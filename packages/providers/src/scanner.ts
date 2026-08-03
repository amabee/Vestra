import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { getLocalFiles, saveLocalFiles, type StorageDriver } from "@vestra/storage";
import type { LibrarySettings, LocalMediaFile } from "@vestra/types";

import { isVideoFile, parseMediaFilename } from "./filename";

/**
 * Local library scanner.
 *
 * Walks the folders the user configured in Settings and indexes video files.
 *
 * SAFETY: only the roots stored in settings are ever traversed. Nothing from a
 * request reaches the filesystem as a path — a scan request carries no path at
 * all, it just triggers a walk of the saved roots. Symlinks are not followed,
 * which prevents both loops and escapes outside the configured roots.
 */

/** Stops a misconfigured root (say `C:\`) from walking the entire disk. */
const MAX_DEPTH = 8;
const MAX_FILES = 20_000;

/** Directories that never contain user media and are expensive to walk. */
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "$recycle.bin",
  "system volume information",
  "windows",
  "appdata",
  "proc",
  "sys",
  "dev",
]);

/** Stable id derived from the absolute path, so re-scans update in place. */
function fileId(absolutePath: string): string {
  return createHash("sha1").update(absolutePath).digest("hex").slice(0, 16);
}

export interface ScanResult {
  files: LocalMediaFile[];
  scanned: number;
  added: number;
  removed: number;
  errors: string[];
}

interface WalkState {
  found: string[];
  errors: string[];
}

async function walk(
  dir: string,
  extensions: readonly string[],
  depth: number,
  state: WalkState,
): Promise<void> {
  if (depth > MAX_DEPTH || state.found.length >= MAX_FILES) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    // Permission denied on one folder must not abort the whole scan.
    state.errors.push(
      `Could not read ${dir}: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return;
  }

  for (const entry of entries) {
    if (state.found.length >= MAX_FILES) return;

    // Never follow symlinks: they can loop, and they can point outside the root.
    if (entry.isSymbolicLink()) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue;
      if (SKIP_DIRECTORIES.has(entry.name.toLowerCase())) continue;
      await walk(full, extensions, depth + 1, state);
      continue;
    }

    if (entry.isFile() && isVideoFile(entry.name, extensions)) {
      state.found.push(full);
    }
  }
}

/**
 * Scan every enabled folder and rewrite the library index.
 *
 * Existing entries are merged rather than replaced, so `addedAt`, generated
 * thumbnails and any metadata match survive a re-scan. Files that disappeared
 * from disk are dropped.
 */
export async function scanLibrary(
  driver: StorageDriver,
  settings: LibrarySettings,
): Promise<ScanResult> {
  const extensions = settings.videoExtensions.map((ext) => ext.toLowerCase());
  const existing = await getLocalFiles(driver);
  const existingById = new Map(existing.map((file) => [file.id, file]));

  const state: WalkState = { found: [], errors: [] };

  for (const folder of settings.folders) {
    if (!folder.enabled) continue;

    const root = path.resolve(folder.path);

    try {
      const stats = await stat(root);
      if (!stats.isDirectory()) {
        state.errors.push(`${folder.path} is not a folder.`);
        continue;
      }
    } catch {
      state.errors.push(`${folder.path} could not be opened.`);
      continue;
    }

    await walk(root, extensions, 0, state);
  }

  const now = Date.now();
  const files: LocalMediaFile[] = [];
  let added = 0;

  for (const absolutePath of state.found) {
    const id = fileId(absolutePath);
    const previous = existingById.get(id);

    let stats;
    try {
      stats = await stat(absolutePath);
    } catch {
      // Vanished between the walk and the stat; skip it.
      continue;
    }

    const size = stats.size;
    // mtimeMs is a float with sub-millisecond precision; the schema wants an
    // integer timestamp, so truncate rather than letting validation reject it.
    const modifiedAt = Math.floor(stats.mtimeMs);

    const fileName = path.basename(absolutePath);
    const parsed = parseMediaFilename(fileName);

    if (!previous) added += 1;

    files.push({
      id,
      path: absolutePath,
      fileName,
      extension: path.extname(fileName).replace(".", "").toLowerCase(),
      sizeBytes: size,
      modifiedAt,
      // Preserve first-seen time so "Recently Added" stays meaningful.
      addedAt: previous?.addedAt ?? now,
      durationSeconds: previous?.durationSeconds ?? null,
      thumbnailPath: previous?.thumbnailPath ?? null,
      parsedTitle: parsed.title,
      parsedSeason: parsed.season,
      parsedEpisode: parsed.episode,
      parsedYear: parsed.year,
      // Keep an existing match; re-matching is a separate, explicit step.
      matchedRef: previous?.matchedRef ?? null,
    });
  }

  const saved = await saveLocalFiles(driver, files);

  return {
    files: saved,
    scanned: state.found.length,
    added,
    removed: Math.max(0, existing.length - (files.length - added)),
    errors: state.errors,
  };
}
