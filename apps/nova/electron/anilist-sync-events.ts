import type {
  MediaItem,
  MediaRef,
  WatchlistEntry,
  WatchlistStatus,
  WatchProgress,
} from "@vestra/types";
import type { AniListRemoteEntry } from "../shared/anilist-sync";

export interface AniListSyncEvents {
  watchlist(
    item: MediaItem,
    status: WatchlistStatus,
    ensure?: boolean,
    automatic?: boolean,
  ): Promise<void>;
  remove(ref: MediaRef): Promise<void>;
  progress(value: WatchProgress): Promise<void>;
  manga(
    source: string,
    id: string,
    title: string,
    saved: boolean,
    progress?: number,
  ): Promise<void>;
  bindManga(source: string, id: string, mediaId: number): Promise<void>;
  animeList(local: WatchlistEntry[]): WatchlistEntry[];
  mangaList(): AniListRemoteEntry[];
  mangaVisible(source: string, id: string): boolean;
  mangaIdentity(source: string, id: string): number | undefined;
}
let sink: AniListSyncEvents | null = null;
export function registerAniListSyncEvents(value: AniListSyncEvents) {
  sink = value;
}
// Local persistence succeeds independently; the account service exposes retry errors.
export async function emitAniList(
  work: (value: AniListSyncEvents) => Promise<void>,
) {
  if (sink) void work(sink).catch(() => undefined);
}
export const mergeAniListWatchlist = (local: WatchlistEntry[]) =>
  sink?.animeList(local) ?? local;
export const aniListMangaEntries = () => sink?.mangaList() ?? [];
export const aniListMangaIdentity = (source: string, id: string) =>
  sink?.mangaIdentity(source, id) ??
  (source === "anilist" ? Number(id) : undefined);
export const aniListMangaVisible = (source: string, id: string) =>
  sink?.mangaVisible(source, id) ?? true;
