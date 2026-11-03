import type { MediaItem, WatchProgress } from "@vestra/types";
import { mediaKey } from "@vestra/types";
export interface EpisodeInventory {
  episodes: { id: string; number: number | null; season: number | null }[];
  updatedAt: number;
  complete: boolean;
}
export interface ChapterCount {
  total: number;
  unread: number | null;
  completed: number;
  updatedAt: number;
  historyKnown: boolean;
}
/** Count unique numbered broadcasts, or exact source identities when numbering is unavailable. */
export function animeUnwatched(
  item: MediaItem,
  aired: number | null,
  progress: Record<string, WatchProgress>,
  inventory?: EpisodeInventory,
): number | null {
  const rows = Object.values(progress).filter(
    (r) => mediaKey(r.ref) === mediaKey(item),
  );
  if (aired != null && Number.isInteger(aired) && aired >= 0) {
    if (rows.some((r) => r.completed && r.episodeNumber == null)) return null;
    const latest = new Map<number, WatchProgress>();
    for (const row of rows) {
      const n = row.episodeNumber;
      if (
        n != null &&
        Number.isInteger(n) &&
        n >= 1 &&
        n <= aired &&
        (!latest.has(n) || latest.get(n)!.updatedAt < row.updatedAt)
      )
        latest.set(n, row);
    }
    return aired - [...latest.values()].filter((r) => r.completed).length;
  }
  if (!inventory?.complete) return null;
  const groups = new Map<string, typeof inventory.episodes>();
  for (const ep of inventory.episodes) {
    const key = ep.number == null ? ep.id : `${ep.season ?? 1}:${ep.number}`;
    groups.set(key, [...(groups.get(key) ?? []), ep]);
  }
  const completed = [...groups.values()].filter((episodes) => {
    const saved = rows
      .filter((row) => episodes.some((ep) => ep.id === row.episodeId))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return saved?.completed;
  }).length;
  return groups.size - completed;
}
