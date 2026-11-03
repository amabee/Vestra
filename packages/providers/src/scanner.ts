import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  getLocalFiles,
  saveLocalFiles,
  type StorageDriver,
} from "@vestra/storage";
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
  config: LibrarySettings["scanner"],
): Promise<void> {
  if (depth > config.maxDepth || state.found.length >= config.maxFiles) return;

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
    if (state.found.length >= config.maxFiles) return;

    // Never follow symlinks: they can loop, and they can point outside the root.
    if (entry.isSymbolicLink()) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue;
      if (
        SKIP_DIRECTORIES.has(entry.name.toLowerCase()) ||
        config.excludedDirectories.some(
          (name) => name.toLowerCase() === entry.name.toLowerCase(),
        )
      )
        continue;
      await walk(full, extensions, depth + 1, state, config);
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
 * thumbnails and metadata survive a re-scan. Missing files are retained so an
 * unavailable directory or bounded scan cannot erase existing library records.
 */
async function performLibraryScan(
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

    await walk(root, extensions, 0, state, settings.scanner);
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

  // A scan is discovery, never an implicit delete operation. Offline roots,
  // changed directories and scan limits must not erase an existing library.
  const foundIds = new Set(files.map((file) => file.id));
  files.push(...existing.filter((file) => !foundIds.has(file.id)));
  const saved = await saveLocalFiles(driver, files);

  return {
    files: saved,
    scanned: state.found.length,
    added,
    removed: 0,
    errors: state.errors,
  };
}

// The provider is also called by completed-download imports, outside Nova's
// refresh service. Serialize here as well so every entry point retains files
// discovered by the preceding scan, including requests with different roots.
const scanQueues = new WeakMap<StorageDriver, Promise<ScanResult>>();
export function scanLibrary(
  driver: StorageDriver,
  settings: LibrarySettings,
): Promise<ScanResult> {
  const previous = scanQueues.get(driver);
  const result = (
    previous ? previous.catch(() => undefined) : Promise.resolve()
  ).then(() => performLibraryScan(driver, settings));
  scanQueues.set(driver, result);
  return result;
}
