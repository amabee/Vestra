import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";

import { getSettings, saveSettings, type StorageDriver } from "@vestra/storage";
import type { LocalFolder, Torrent } from "@vestra/types";

import { scanLibrary } from "./scanner";

/**
 * Auto-import completed downloads into the local library.
 *
 * Rather than indexing torrent contents into a parallel store, this registers
 * the completed content's folder as a normal library folder and re-runs the
 * ordinary scan. The user can see and remove those folders in Settings, and a
 * later re-scan behaves identically to one they triggered by hand.
 *
 * Only torrents in the configured Vestra category are considered, so Vestra
 * never absorbs unrelated transfers from the same client.
 */

export interface AutoImportResult {
  enabled: boolean;
  /** Completed torrents inspected. */
  checked: number;
  /** Folders newly registered with the library. */
  addedFolders: string[];
  /** Files indexed by the follow-up scan, when one ran. */
  scannedFiles: number | null;
  errors: string[];
}

function folderId(absolutePath: string): string {
  return createHash("sha1").update(absolutePath).digest("hex").slice(0, 16);
}

/** True when `candidate` is the same as, or nested inside, `root`. */
function isCoveredBy(candidate: string, root: string): boolean {
  const normalisedRoot = path.resolve(root);
  const normalisedCandidate = path.resolve(candidate);

  if (normalisedCandidate === normalisedRoot) return true;
  return normalisedCandidate.startsWith(normalisedRoot + path.sep);
}

/**
 * Resolve the folder to index for a torrent.
 *
 * `content_path` points at the single file for a one-file torrent and at the
 * containing directory for a multi-file one, so a file is walked up to its
 * parent. Returns null when the path is not reachable from this machine —
 * which is the normal case for a qBittorrent instance running on another host.
 */
async function resolveFolder(contentPath: string): Promise<string | null> {
  try {
    const stats = await stat(contentPath);
    return stats.isDirectory() ? path.resolve(contentPath) : path.dirname(path.resolve(contentPath));
  } catch {
    return null;
  }
}

export async function importCompletedDownloads(
  driver: StorageDriver,
  torrents: readonly Torrent[],
): Promise<AutoImportResult> {
  const settings = await getSettings(driver);

  if (!settings.downloads.autoImportCompleted) {
    return { enabled: false, checked: 0, addedFolders: [], scannedFiles: null, errors: [] };
  }

  const category = settings.downloads.category;

  const completed = torrents.filter(
    (torrent) =>
      (torrent.state === "completed" || torrent.state === "seeding") &&
      torrent.progress >= 1 &&
      torrent.contentPath !== null &&
      // Empty category means the user did not scope Vestra's downloads.
      (category === "" || torrent.category === category),
  );

  const errors: string[] = [];
  const existingFolders = [...settings.library.folders];
  const addedFolders: string[] = [];
  let unreachable = 0;

  for (const torrent of completed) {
    const folder = await resolveFolder(torrent.contentPath as string);

    if (!folder) {
      unreachable += 1;
      continue;
    }

    // Skip when an existing folder already covers this path, so nested
    // downloads never register a second, redundant root.
    const covered = existingFolders.some((entry) => isCoveredBy(folder, entry.path));
    if (covered) continue;

    const next: LocalFolder = {
      id: folderId(folder),
      path: folder,
      label: `Downloads · ${torrent.name}`.slice(0, 80),
      enabled: true,
      lastScannedAt: null,
      fileCount: 0,
    };

    existingFolders.push(next);
    addedFolders.push(folder);
  }

  if (unreachable > 0) {
    errors.push(
      `${unreachable} completed download${unreachable === 1 ? "" : "s"} could not be reached on this machine. ` +
        "This is expected when qBittorrent runs on another host.",
    );
  }

  // Nothing new: skip the scan entirely so polling stays cheap.
  if (addedFolders.length === 0) {
    return {
      enabled: true,
      checked: completed.length,
      addedFolders: [],
      scannedFiles: null,
      errors,
    };
  }

  const updated = {
    ...settings,
    library: { ...settings.library, folders: existingFolders },
  };
  await saveSettings(driver, updated);

  const scan = await scanLibrary(driver, updated.library);

  return {
    enabled: true,
    checked: completed.length,
    addedFolders,
    scannedFiles: scan.scanned,
    errors: [...errors, ...scan.errors],
  };
}
