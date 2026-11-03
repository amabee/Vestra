import { getWatchlist, getHistory, type StorageDriver } from "@vestra/storage";
import { normaliseAnime } from "@vestra/api/anilist";
import {
  mediaKey,
  type MediaItem,
  type MediaRef,
  type WatchlistEntry,
  type WatchlistStatus,
  type WatchProgress,
} from "@vestra/types";
import type { AniListAccount } from "./anilist-account";
import type { AniListSyncEvents } from "./anilist-sync-events";
import { AnimePlaylists } from "./anime-playlists";
import type { MangaBookmarkRepository } from "./manga-bookmarks";
import {
  type AniListChange,
  type AniListRemoteEntry,
} from "../shared/anilist-sync";
import { changeKey } from "./anilist-sync";

export const toAniListStatus = {
  planned: "PLANNING",
  watching: "CURRENT",
  completed: "COMPLETED",
  paused: "PAUSED",
  dropped: "DROPPED",
} as const;
const fromStatus = {
  PLANNING: "planned",
  CURRENT: "watching",
  COMPLETED: "completed",
  PAUSED: "paused",
  DROPPED: "dropped",
  REPEATING: "watching",
} as const;
export function remoteWatchlistEntry(
  entry: AniListRemoteEntry,
): WatchlistEntry {
  const item = normaliseAnime(entry.media);
  return {
    ref: { source: "anilist", kind: "anime", sourceId: String(entry.mediaId) },
    snapshot: item,
    status: fromStatus[entry.status],
    addedAt: entry.updatedAt * 1000,
    updatedAt: entry.updatedAt * 1000,
    userRating: null,
    notes: null,
  };
}
export class AniListLibrarySync implements AniListSyncEvents {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private bootstrapWork: Promise<void> | null = null;
  constructor(
    private account: AniListAccount,
    private driver: StorageDriver,
    private bookmarks: () => MangaBookmarkRepository,
    private changed: () => void,
  ) {}
  private async queue(change: Omit<AniListChange, "at">) {
    await this.account.queueListChange({ ...change, at: Date.now() });
    this.changed();
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.sync().catch(() => undefined);
      }, 1500);
      this.timer.unref();
    }
  }
  async watchlist(
    item: MediaItem,
    status: WatchlistStatus,
    ensure = false,
    automatic = false,
  ) {
    if (item.kind !== "anime") return;
    await this.queue({
      type: "ANIME",
      source: item.source,
      sourceId: item.sourceId,
      title: item.title.slice(0, 500),
      year: item.year,
      ...(item.source === "anilist" && /^\d+$/.test(item.sourceId)
        ? { mediaId: Number(item.sourceId) }
        : {}),
      action: automatic ? "progress" : ensure ? "ensure" : "status",
      ...(!automatic ? { status: toAniListStatus[status] } : {}),
    });
  }
  async remove(ref: MediaRef) {
    if (ref.kind !== "anime") return;
    const saved = this.animeList(await getWatchlist(this.driver)).find(
      (row) => mediaKey(row.ref) === mediaKey(ref),
    );
    await this.queue({
      type: "ANIME",
      source: ref.source,
      sourceId: ref.sourceId,
      title: saved?.snapshot.title ?? "",
      ...(ref.source === "anilist" && /^\d+$/.test(ref.sourceId)
        ? { mediaId: Number(ref.sourceId) }
        : {}),
      action: "remove",
    });
  }
  async progress(value: WatchProgress) {
    if (value.ref.kind !== "anime" || value.percent < 0.01) return;
    const ref = value.ref;
    const items = [
      ...(await getWatchlist(this.driver)).map((row) => row.snapshot),
      ...(await getHistory(this.driver)).map((row) => row.snapshot),
    ];
    const item = items.find((row) => mediaKey(row) === mediaKey(ref));
    const number =
      value.completed && Number.isInteger(value.episodeNumber)
        ? (value.episodeNumber ?? undefined)
        : undefined;
    await this.queue({
      type: "ANIME",
      source: ref.source,
      sourceId: ref.sourceId,
      title: item?.title.slice(0, 500) ?? "",
      year: item?.year,
      ...(ref.source === "anilist" && /^\d+$/.test(ref.sourceId)
        ? { mediaId: Number(ref.sourceId) }
        : {}),
      action: "progress",
      ...(number !== undefined ? { progress: number } : {}),
    });
  }
  async manga(
    source: string,
    id: string,
    title: string,
    saved: boolean,
    progress?: number,
  ) {
    await this.queue({
      type: "MANGA",
      source,
      sourceId: id,
      title: title.slice(0, 500),
      ...(source === "anilist" && /^\d+$/.test(id)
        ? { mediaId: Number(id) }
        : {}),
      action: !saved
        ? "remove"
        : progress !== undefined
          ? "progress"
          : "ensure",
      ...(progress !== undefined ? { progress } : {}),
    });
  }
  async bindManga(source: string, id: string, mediaId: number) {
    await this.account.bindListIdentity("MANGA", source, id, mediaId);
    this.changed();
  }
  animeList(local: WatchlistEntry[]) {
    const sync = this.account.listSyncState();
    if (!this.account.status().user) return local;
    const rows = new Map(local.map((row) => [mediaKey(row.ref), row]));
    const links = new Map(sync.links.map((row) => [row.key, row.mediaId]));
    const aliases = new Map<number, WatchlistEntry>();
    const managed = new Set(sync.managed);
    const identity = (row: WatchlistEntry) =>
      row.ref.source === "anilist"
        ? Number(row.ref.sourceId)
        : links.get(
            changeKey({
              type: "ANIME",
              source: row.ref.source,
              sourceId: row.ref.sourceId,
            }),
          );
    for (const row of local) {
      const id = identity(row);
      if (id) aliases.set(id, row);
    }
    const pending = new Map(
      sync.pending
        .filter((row) => row.type === "ANIME" && row.mediaId)
        .map((row) => [row.mediaId!, row]),
    );
    const remote = new Set(
      sync.entries
        .filter((row) => row.media.type === "ANIME")
        .map((row) => row.mediaId),
    );
    for (const row of local) {
      const id = identity(row);
      if (!id) continue;
      if (managed.has(`ANIME:${id}`) && !remote.has(id) && !pending.has(id))
        rows.delete(mediaKey(row.ref));
    }
    for (const entry of sync.entries.filter(
      (row) => row.media.type === "ANIME",
    )) {
      const change = pending.get(entry.mediaId);
      const key = `anilist:anime:${entry.mediaId}`;
      const alias = aliases.get(entry.mediaId);
      const localKey = alias ? mediaKey(alias.ref) : key;
      if (change?.action === "remove") {
        rows.delete(key);
        rows.delete(localKey);
        continue;
      }
      if (change && rows.has(localKey)) continue;
      const remoteEntry = remoteWatchlistEntry(entry);
      rows.set(
        localKey,
        alias
          ? {
              ...alias,
              status: remoteEntry.status,
              updatedAt: remoteEntry.updatedAt,
            }
          : remoteEntry,
      );
      if (localKey !== key) rows.delete(key);
    }
    return [...rows.values()];
  }
  mangaList() {
    const sync = this.account.listSyncState();
    const removed = new Set(
      sync.pending
        .filter((row) => row.type === "MANGA" && row.action === "remove")
        .map((row) => row.mediaId),
    );
    return sync.entries.filter(
      (row) => row.media.type === "MANGA" && !removed.has(row.mediaId),
    );
  }
  mangaVisible(source: string, id: string) {
    const sync = this.account.listSyncState();
    const mediaId = this.mangaIdentity(source, id);
    if (!mediaId) return true;
    const pending = sync.pending.find(
      (row) => row.type === "MANGA" && row.mediaId === mediaId,
    );
    if (pending) return pending.action !== "remove";
    return (
      !sync.managed.includes(`MANGA:${mediaId}`) ||
      sync.entries.some((row) => row.mediaId === mediaId)
    );
  }
  mangaIdentity(source: string, id: string) {
    return source === "anilist"
      ? Number(id)
      : this.account
          .listSyncState()
          .links.find(
            (row) =>
              row.key === changeKey({ type: "MANGA", source, sourceId: id }),
          )?.mediaId;
  }
  private bootstrap() {
    return (this.bootstrapWork ??= (async () => {
      if (!this.account.status().connected) return;
      let budget = Math.min(
        100,
        1000 - this.account.listSyncState().pending.length,
      );
      const needed = (
        type: "ANIME" | "MANGA",
        source: string,
        sourceId: string,
      ) => {
        if (budget <= 0) return false;
        const sync = this.account.listSyncState();
        const key = changeKey({ type, source, sourceId });
        const mediaId =
          source === "anilist"
            ? Number(sourceId)
            : sync.links.find((row) => row.key === key)?.mediaId;
        if (
          sync.pending.some((row) => changeKey(row) === key) ||
          (mediaId && sync.managed.includes(`${type}:${mediaId}`))
        )
          return false;
        budget--;
        return true;
      };
      const watchlist = await getWatchlist(this.driver);
      for (const row of watchlist)
        if (
          row.snapshot.kind === "anime" &&
          needed("ANIME", row.ref.source, row.ref.sourceId)
        )
          await this.watchlist(row.snapshot, row.status, true);
      for (const list of await new AnimePlaylists(() => this.driver).list())
        for (const row of list.items)
          if (needed("ANIME", row.item.source, row.item.sourceId))
            await this.watchlist(row.item, "planned", true);
      for (const row of await this.bookmarks().list())
        if (needed("MANGA", row.source, row.id))
          await this.manga(row.source, row.id, row.title, true);
    })().finally(() => {
      this.bootstrapWork = null;
    }));
  }
  async sync(force = false) {
    await this.bootstrap();
    await this.account.syncLists(force);
    this.changed();
  }
}
