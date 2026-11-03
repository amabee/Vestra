import { useQuery } from "@tanstack/react-query";
import { useSettings, keys } from "@/lib/queries";
import { bridge } from "@/lib/bridge";
import { mediaKey, type MediaItem } from "@vestra/types";
import { animeUnwatched } from "../../../../shared/media-counts";

export function AnimeUnwatchedBadge({
  item,
  aired = null,
  provider = "local",
}: {
  item: MediaItem;
  aired?: number | null;
  provider?: string;
}) {
  const { data: settings } = useSettings();
  const enabled =
    settings?.privacy.animeUnwatchedCount === true && item.kind === "anime";
  const progress = useQuery({
    queryKey: keys.progress,
    queryFn: bridge.progress.all,
    enabled,
  });
  const inventory = useQuery({
    queryKey: ["anime-episode-inventories"],
    queryFn: bridge.anime.inventories,
    enabled: enabled && aired === null,
    staleTime: 60000,
  });
  if (
    !enabled ||
    !progress.data ||
    progress.error ||
    (aired === null && inventory.error)
  )
    return null;
  const snapshot = inventory.data?.[`${mediaKey(item)}:${provider}`];
  const count = animeUnwatched(item, aired, progress.data, snapshot);
  return count === null ? null : (
    <span
      className="media-count-badge"
      title={
        aired !== null
          ? "Unwatched aired episodes, using recorded episode completions"
          : `Unwatched source episodes · inventory updated ${snapshot ? new Date(snapshot.updatedAt).toLocaleString() : ""}`
      }
      aria-label={`${count} unwatched episodes`}
    >
      {count} unwatched
    </span>
  );
}
export function MangaUnreadBadge({
  provider,
  bookId,
  catalogue = false,
}: {
  provider: string;
  bookId: string;
  catalogue?: boolean;
}) {
  const { data: settings } = useSettings();
  const enabled =
    settings?.privacy.mangaUnreadCount === true && !!provider && !!bookId;
  const count = useQuery({
    queryKey: ["manga-unread", provider, bookId, catalogue],
    queryFn: () => bridge.manga.unread(provider, bookId, catalogue),
    enabled,
    staleTime: 60000,
    retry: false,
  });
  if (!enabled || !count.data || count.error) return null;
  return (
    <span
      className="media-count-badge"
      title={
        count.data.historyKnown
          ? `Unread source chapters · inventory updated ${new Date(count.data.updatedAt).toLocaleString()}`
          : "Earlier reading history has no chapter-completion records. Reconcile it in manga details."
      }
      aria-label={
        count.data.unread === null
          ? "Unread chapter count unknown"
          : `${count.data.unread} unread chapters`
      }
    >
      {count.data.unread ?? "—"} unread
    </span>
  );
}
