import { z } from "zod";

import { MAX_RECENT_SEARCHES, STORAGE_KEYS } from "@vestra/config/constants";
import {
  DEFAULT_SETTINGS,
  historyEntrySchema,
  isSameMedia,
  localMediaFileSchema,
  mediaKey,
  recentSearchSchema,
  settingsSchema,
  watchProgressSchema,
  watchlistEntrySchema,
  type HistoryEntry,
  type LocalMediaFile,
  type MediaItem,
  type MediaRef,
  type RecentSearch,
  type Settings,
  type WatchProgress,
  type WatchlistEntry,
  type WatchlistStatus,
} from "@vestra/types";

import { readDocument, writeDocument, type StorageDriver } from "./driver";

/**
 * Document-level repositories over a StorageDriver.
 *
 * Each collection is one JSON document. That keeps reads trivial and is a fine
 * fit for a personal library; swapping in SQLite later only changes this file.
 */

/* -----------------------------------------------------------------------------
 * Document schemas
 * -------------------------------------------------------------------------- */

const watchlistDocSchema = z.object({
  version: z.literal(1).default(1),
  entries: z.array(watchlistEntrySchema).default([]),
});

const historyDocSchema = z.object({
  version: z.literal(1).default(1),
  entries: z.array(historyEntrySchema).default([]),
});

const progressDocSchema = z.object({
  version: z.literal(1).default(1),
  /** Keyed by `mediaKey(ref)` plus an optional `#episodeId` suffix. */
  entries: z.record(z.string(), watchProgressSchema).default({}),
});

const localLibraryDocSchema = z.object({
  version: z.literal(1).default(1),
  files: z.array(localMediaFileSchema).default([]),
});

const recentSearchesDocSchema = z.object({
  version: z.literal(1).default(1),
  entries: z.array(recentSearchSchema).default([]),
});

const EMPTY_WATCHLIST = { version: 1 as const, entries: [] };
const EMPTY_HISTORY = { version: 1 as const, entries: [] };
const EMPTY_PROGRESS = { version: 1 as const, entries: {} };
const EMPTY_LIBRARY = { version: 1 as const, files: [] };
const EMPTY_SEARCHES = { version: 1 as const, entries: [] };

/** Progress is tracked per episode for series, per item for everything else. */
export function progressKey(ref: MediaRef, episodeId: string | null = null): string {
  return episodeId ? `${mediaKey(ref)}#${episodeId}` : mediaKey(ref);
}

/* =============================================================================
 * Settings
 * ========================================================================== */

export async function getSettings(driver: StorageDriver): Promise<Settings> {
  return readDocument(driver, STORAGE_KEYS.settings, settingsSchema, DEFAULT_SETTINGS);
}

export async function saveSettings(
  driver: StorageDriver,
  settings: Settings,
): Promise<Settings> {
  return writeDocument(driver, STORAGE_KEYS.settings, settingsSchema, settings);
}

/** Shallow-merge a partial update into the stored settings. */
export async function updateSettings(
  driver: StorageDriver,
  patch: Partial<Settings>,
): Promise<Settings> {
  const current = await getSettings(driver);
  return saveSettings(driver, { ...current, ...patch });
}

/* =============================================================================
 * Watchlist
 * ========================================================================== */

export async function getWatchlist(driver: StorageDriver): Promise<WatchlistEntry[]> {
  const doc = await readDocument(
    driver,
    STORAGE_KEYS.watchlist,
    watchlistDocSchema,
    EMPTY_WATCHLIST,
  );
  return doc.entries;
}

export async function isInWatchlist(
  driver: StorageDriver,
  ref: MediaRef,
): Promise<boolean> {
  const entries = await getWatchlist(driver);
  return entries.some((entry) => isSameMedia(entry.ref, ref));
}

export async function addToWatchlist(
  driver: StorageDriver,
  item: MediaItem,
  status: WatchlistStatus = "planned",
): Promise<WatchlistEntry[]> {
  const entries = await getWatchlist(driver);
  const now = Date.now();
  const ref: MediaRef = { source: item.source, kind: item.kind, sourceId: item.sourceId };

  const existing = entries.find((entry) => isSameMedia(entry.ref, ref));

  const next: WatchlistEntry[] = existing
    ? entries.map((entry) =>
        isSameMedia(entry.ref, ref)
          ? { ...entry, status, snapshot: item, updatedAt: now }
          : entry,
      )
    : [
        {
          ref,
          snapshot: item,
          status,
          addedAt: now,
          updatedAt: now,
          userRating: null,
          notes: null,
        },
        ...entries,
      ];

  await writeDocument(driver, STORAGE_KEYS.watchlist, watchlistDocSchema, {
    version: 1,
    entries: next,
  });

  return next;
}

export async function removeFromWatchlist(
  driver: StorageDriver,
  ref: MediaRef,
): Promise<WatchlistEntry[]> {
  const entries = await getWatchlist(driver);
  const next = entries.filter((entry) => !isSameMedia(entry.ref, ref));

  await writeDocument(driver, STORAGE_KEYS.watchlist, watchlistDocSchema, {
    version: 1,
    entries: next,
  });

  return next;
}

/** Add when absent, remove when present. Returns the resulting membership. */
export async function toggleWatchlist(
  driver: StorageDriver,
  item: MediaItem,
): Promise<{ inWatchlist: boolean; entries: WatchlistEntry[] }> {
  const ref: MediaRef = { source: item.source, kind: item.kind, sourceId: item.sourceId };

  if (await isInWatchlist(driver, ref)) {
    return { inWatchlist: false, entries: await removeFromWatchlist(driver, ref) };
  }

  return { inWatchlist: true, entries: await addToWatchlist(driver, item) };
}

/* =============================================================================
 * Watch progress
 * ========================================================================== */

export async function getAllProgress(
  driver: StorageDriver,
): Promise<Record<string, WatchProgress>> {
  const doc = await readDocument(
    driver,
    STORAGE_KEYS.progress,
    progressDocSchema,
    EMPTY_PROGRESS,
  );
  return doc.entries;
}

export async function getProgress(
  driver: StorageDriver,
  ref: MediaRef,
  episodeId: string | null = null,
): Promise<WatchProgress | null> {
  const entries = await getAllProgress(driver);
  return entries[progressKey(ref, episodeId)] ?? null;
}

export interface SaveProgressInput {
  ref: MediaRef;
  episodeId?: string | null;
  positionSeconds: number;
  durationSeconds: number;
  /** Fraction of runtime after which the item counts as watched. */
  markWatchedAt?: number;
}

export async function saveProgress(
  driver: StorageDriver,
  input: SaveProgressInput,
): Promise<WatchProgress> {
  const {
    ref,
    episodeId = null,
    positionSeconds,
    durationSeconds,
    markWatchedAt = 0.9,
  } = input;

  const percent =
    durationSeconds > 0
      ? Math.min(1, Math.max(0, positionSeconds / durationSeconds))
      : 0;

  const entry: WatchProgress = {
    ref,
    episodeId,
    positionSeconds: Math.max(0, positionSeconds),
    durationSeconds: Math.max(0, durationSeconds),
    percent,
    completed: percent >= markWatchedAt,
    updatedAt: Date.now(),
  };

  const entries = await getAllProgress(driver);
  entries[progressKey(ref, episodeId)] = entry;

  await writeDocument(driver, STORAGE_KEYS.progress, progressDocSchema, {
    version: 1,
    entries,
  });

  return entry;
}

export async function clearProgress(
  driver: StorageDriver,
  ref: MediaRef,
  episodeId: string | null = null,
): Promise<void> {
  const entries = await getAllProgress(driver);
  delete entries[progressKey(ref, episodeId)];

  await writeDocument(driver, STORAGE_KEYS.progress, progressDocSchema, {
    version: 1,
    entries,
  });
}

/* =============================================================================
 * History
 * ========================================================================== */

const MAX_HISTORY_ENTRIES = 500;

export async function getHistory(driver: StorageDriver): Promise<HistoryEntry[]> {
  const doc = await readDocument(
    driver,
    STORAGE_KEYS.history,
    historyDocSchema,
    EMPTY_HISTORY,
  );
  return doc.entries;
}

export async function addHistoryEntry(
  driver: StorageDriver,
  input: {
    item: MediaItem;
    episodeId?: string | null;
    positionSeconds?: number;
    completed?: boolean;
  },
): Promise<HistoryEntry[]> {
  const { item, episodeId = null, positionSeconds = 0, completed = false } = input;
  const ref: MediaRef = { source: item.source, kind: item.kind, sourceId: item.sourceId };
  const now = Date.now();

  const entry: HistoryEntry = {
    id: `${progressKey(ref, episodeId)}@${now}`,
    ref,
    snapshot: item,
    episodeId,
    watchedAt: now,
    positionSeconds,
    completed,
  };

  const entries = await getHistory(driver);

  // Collapse repeat views of the same episode into a single, most-recent row.
  const deduped = entries.filter(
    (existing) => !(isSameMedia(existing.ref, ref) && existing.episodeId === episodeId),
  );

  const next = [entry, ...deduped].slice(0, MAX_HISTORY_ENTRIES);

  await writeDocument(driver, STORAGE_KEYS.history, historyDocSchema, {
    version: 1,
    entries: next,
  });

  return next;
}

export async function clearHistory(driver: StorageDriver): Promise<void> {
  await writeDocument(driver, STORAGE_KEYS.history, historyDocSchema, {
    version: 1,
    entries: [],
  });
}

/* =============================================================================
 * Local library
 * ========================================================================== */

export async function getLocalFiles(driver: StorageDriver): Promise<LocalMediaFile[]> {
  const doc = await readDocument(
    driver,
    STORAGE_KEYS.localLibrary,
    localLibraryDocSchema,
    EMPTY_LIBRARY,
  );
  return doc.files;
}

export async function saveLocalFiles(
  driver: StorageDriver,
  files: LocalMediaFile[],
): Promise<LocalMediaFile[]> {
  const doc = await writeDocument(
    driver,
    STORAGE_KEYS.localLibrary,
    localLibraryDocSchema,
    { version: 1, files },
  );
  return doc.files;
}

/* =============================================================================
 * Recent searches
 * ========================================================================== */

export async function getRecentSearches(driver: StorageDriver): Promise<RecentSearch[]> {
  const doc = await readDocument(
    driver,
    STORAGE_KEYS.recentSearches,
    recentSearchesDocSchema,
    EMPTY_SEARCHES,
  );
  return doc.entries;
}

export async function addRecentSearch(
  driver: StorageDriver,
  query: string,
): Promise<RecentSearch[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return getRecentSearches(driver);

  const entries = await getRecentSearches(driver);
  const deduped = entries.filter(
    (entry) => entry.query.toLowerCase() !== trimmed.toLowerCase(),
  );

  const next = [{ query: trimmed, searchedAt: Date.now() }, ...deduped].slice(
    0,
    MAX_RECENT_SEARCHES,
  );

  await writeDocument(driver, STORAGE_KEYS.recentSearches, recentSearchesDocSchema, {
    version: 1,
    entries: next,
  });

  return next;
}

export async function clearRecentSearches(driver: StorageDriver): Promise<void> {
  await writeDocument(driver, STORAGE_KEYS.recentSearches, recentSearchesDocSchema, {
    version: 1,
    entries: [],
  });
}
