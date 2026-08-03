import { getAllProgress, getWatchlist, type StorageDriver } from "@vestra/storage";
import type { DiscoverRow, MediaItem, WatchProgress } from "@vestra/types";

/**
 * "Continue Watching" — partially watched items, most recent first.
 *
 * Items below 1% are treated as accidental opens and skipped; completed items
 * drop off the row entirely.
 */

const MIN_PERCENT = 0.01;

export interface ContinueWatchingItem {
  item: MediaItem;
  progress: WatchProgress;
}

export async function getContinueWatching(
  driver: StorageDriver,
  limit = 20,
): Promise<ContinueWatchingItem[]> {
  const [progressMap, watchlist] = await Promise.all([
    getAllProgress(driver),
    getWatchlist(driver),
  ]);

  // Watchlist snapshots are the only local source of poster/title metadata,
  // so progress without a matching snapshot can't be rendered as a card.
  const snapshots = new Map(
    watchlist.map((entry) => [
      `${entry.ref.source}:${entry.ref.kind}:${entry.ref.sourceId}`,
      entry.snapshot,
    ]),
  );

  return Object.values(progressMap)
    .filter(
      (progress) =>
        !progress.completed &&
        progress.percent >= MIN_PERCENT &&
        progress.durationSeconds > 0,
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .flatMap((progress) => {
      const key = `${progress.ref.source}:${progress.ref.kind}:${progress.ref.sourceId}`;
      const item = snapshots.get(key);
      return item ? [{ item, progress }] : [];
    })
    .slice(0, limit);
}

export function toContinueWatchingRow(entries: ContinueWatchingItem[]): DiscoverRow {
  return {
    id: "continue-watching",
    title: "Continue Watching",
    subtitle: null,
    items: entries.map((entry) => entry.item),
    href: null,
  };
}

/** Seconds to resume from, respecting the user's "remember position" preference. */
export function resumePosition(
  progress: WatchProgress | null,
  rememberPosition: boolean,
): number {
  if (!progress || !rememberPosition || progress.completed) return 0;
  if (progress.percent < MIN_PERCENT) return 0;
  return Math.floor(progress.positionSeconds);
}
