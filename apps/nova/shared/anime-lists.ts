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
) {
  const items = new Map<string, MediaItem>();
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
  const statuses = new Map(
    watchlist.map((row) => [mediaKey(row.ref), row.status]),
  );
  const rows = [...items.values()].map((item) => ({
    item,
    progress: latest.get(mediaKey(item)),
    status:
      statuses.get(mediaKey(item)) ??
      ((latest.has(mediaKey(item)) ||
      history.some(
        (h) => mediaKey(h.ref) === mediaKey(item) && h.positionSeconds > 0,
      )
        ? "watching"
        : "planned") as WatchlistStatus),
  }));
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
