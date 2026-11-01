import {
  mediaKey,
  type MediaItem,
  type WatchProgress,
  type WatchlistEntry,
  type WatchlistStatus,
  type HistoryEntry,
} from "@vestra/types";
import type { AnimePlaylist } from "./playlists";

export const animeListLabels: Record<WatchlistStatus, string> = {
  watching: "Currently watching",
  planned: "Plan to watch",
  completed: "Completed",
  paused: "On hold",
  dropped: "Dropped",
};
export function animeHomeModel(
  watchlist: WatchlistEntry[],
  history: HistoryEntry[],
  playlists: AnimePlaylist[],
  progress: Record<string, WatchProgress>,
  recovered: MediaItem[] = [],
) {
  const items = new Map<string, MediaItem>();
  for (const item of recovered)
    if (item.kind === "anime") items.set(mediaKey(item), item);
  for (const row of history)
    if (row.snapshot.kind === "anime" && !items.has(mediaKey(row.snapshot)))
      items.set(mediaKey(row.snapshot), row.snapshot);
  for (const list of playlists)
    for (const row of list.items)
      if (row.item.kind === "anime") items.set(mediaKey(row.item), row.item);
  for (const row of watchlist)
    if (row.snapshot.kind === "anime")
      items.set(mediaKey(row.ref), row.snapshot);
  const latest = new Map<string, WatchProgress>();
  for (const value of Object.values(progress)) {
    if (value.ref.kind !== "anime") continue;
    const key = mediaKey(value.ref),
      previous = latest.get(key);
    if (!previous || value.updatedAt > previous.updatedAt)
      latest.set(key, value);
  }
  const started = new Map<string, number>();
  for (const row of history)
    if (row.positionSeconds > 0) {
      const key = mediaKey(row.ref);
      started.set(key, Math.max(started.get(key) ?? 0, row.watchedAt ?? 0));
    }
  for (const value of Object.values(progress))
    if (value.percent >= 0.01 && value.positionSeconds > 0) {
      const key = mediaKey(value.ref);
      started.set(key, Math.max(started.get(key) ?? 0, value.updatedAt));
    }
  const entries = new Map(watchlist.map((row) => [mediaKey(row.ref), row]));
  const rows = [...items.values()].map((item) => {
    const key = mediaKey(item),
      entry = entries.get(key);
    // Actual playback promotes an older planned entry. A newer explicit list
    // change still wins, so a user can deliberately plan a rewatch.
    const status: WatchlistStatus =
      entry?.status === "planned" && (started.get(key) ?? 0) > entry.updatedAt
        ? "watching"
        : (entry?.status ?? (started.has(key) ? "watching" : "planned"));
    return { item, progress: latest.get(key), status };
  });
  return {
    continueWatching: rows
      .filter(
        (row) =>
          row.status === "watching" &&
          row.progress &&
          !row.progress.completed &&
          row.progress.percent >= 0.01 &&
          row.progress.durationSeconds > 0,
      )
      .sort((a, b) => b.progress!.updatedAt - a.progress!.updatedAt),
    groups: (Object.keys(animeListLabels) as WatchlistStatus[]).map(
      (status) => ({
        status,
        title: animeListLabels[status],
        items: rows.filter((row) => row.status === status),
      }),
    ),
  };
}
