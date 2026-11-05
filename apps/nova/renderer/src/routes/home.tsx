import {
  useContinueShelf,
  ContinueShelfNotice,
} from "@/lib/use-continue-shelf";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { mediaKey, type MediaItem, type WatchlistStatus } from "@vestra/types";
import { bridge } from "@/lib/bridge";
import {
  useSettings,
  useWatchlist,
  useHistory,
  useProgress,
} from "@/lib/queries";
import {
  AnimeHubHeader,
  useAnimeHub,
  useAnimeHubActions,
} from "@/components/media/anime-hub-context";
import {
  AnimeCarousel,
  AnimeHubCard,
} from "@/components/media/anime-hub-cards";
import { animeHomeModel } from "@/components/media/anime-hub-model";
import { playlistKey } from "@/components/media/playlist-picker";

export function HomeRoute() {
  const { data: settings } = useSettings();
  const continueShelf = useContinueShelf();
  const hub = useAnimeHub(),
    controls = useAnimeHubActions(hub.provider);
  const watchlist = useWatchlist(),
    history = useHistory(),
    progress = useProgress();
  const lists = useQuery({
    queryKey: playlistKey,
    queryFn: bridge.playlists.list,
  });
  const loading =
    watchlist.isPending ||
    history.isPending ||
    progress.isPending ||
    lists.isPending;
  const failure =
    watchlist.error || history.error || progress.error || lists.error;
  const known = new Set([
    ...(watchlist.data ?? []).map((row) => mediaKey(row.ref)),
    ...(history.data ?? []).map((row) => mediaKey(row.ref)),
    ...(lists.data ?? []).flatMap((list) =>
      list.items.map((row) => mediaKey(row.item)),
    ),
  ]);
  const untracked = Object.values(progress.data ?? {})
    .filter(
      (row) =>
        row.ref.kind === "anime" &&
        row.percent >= 0.01 &&
        !known.has(mediaKey(row.ref)),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const missingIds = [
    ...new Set(
      untracked
        .filter(
          (row) =>
            row.ref.source === "anilist" && /^[1-9]\d*$/.test(row.ref.sourceId),
        )
        .map((row) => Number(row.ref.sourceId)),
    ),
  ].slice(0, 24);
  const recovery = useQuery({
    queryKey: ["anime-history-titles", missingIds],
    queryFn: () => bridge.anime.snapshots(missingIds),
    enabled: !loading && !failure && missingIds.length > 0,
    staleTime: 300000,
    retry: false,
  });
  const model = useMemo(
    () =>
      animeHomeModel(
        watchlist.data ?? [],
        history.data ?? [],
        lists.data ?? [],
        progress.data ?? {},
        recovery.data ?? [],
      ),
    [watchlist.data, history.data, lists.data, progress.data, recovery.data],
  );
  const continueWatching = model.continueWatching.filter(
    (row) =>
      !continueShelf.hidden(
        { kind: "anime", ref: { ...row.item, kind: "anime" } },
        row.progress?.updatedAt ?? 0,
      ),
  );
  const cards = (
    rows: {
      item: MediaItem;
      status: WatchlistStatus;
      progress?: { percent: number };
    }[],
    resume = false,
  ) =>
    [...rows]
      .sort((a, b) => {
        const order = resume
          ? settings?.appearance.continueWatchingSort
          : settings?.appearance.animeLibrarySort;
        if (order === "alphabetical")
          return a.item.title.localeCompare(b.item.title);
        if (order === "release") return (b.item.year ?? 0) - (a.item.year ?? 0);
        if (!resume && order === "added") {
          const added = (item: MediaItem) =>
            watchlist.data?.find((v) => mediaKey(v.ref) === mediaKey(item))
              ?.addedAt ?? 0;
          return added(b.item) - added(a.item);
        }
        return 0;
      })
      .map((row) => (
        <AnimeHubCard
          key={mediaKey(row.item)}
          title={{
            item: row.item,
            totalEpisodes: null,
            airedEpisodes: null,
            season: null,
            format: null,
          }}
          provider={hub.provider}
          status={row.status}
          percent={resume ? row.progress?.percent : undefined}
          onPlay={() =>
            controls.actions.mutate({ item: row.item, provider: hub.provider })
          }
          disabled={!hub.available}
          busy={
            controls.actions.isPending &&
            mediaKey(controls.actions.variables.item) === mediaKey(row.item)
          }
          onRemoveContinue={
            resume
              ? () =>
                  continueShelf.remove.mutate({
                    kind: "anime",
                    ref: { ...row.item, kind: "anime" },
                  })
              : undefined
          }
          removingContinue={continueShelf.remove.isPending}
          onPlaylist={() => controls.setSaving(row.item)}
          working={controls.status.isPending}
          onStatus={(status) =>
            controls.status.mutate({ item: row.item, status })
          }
        />
      ));
  return (
    <div className="anime-hub">
      <AnimeHubHeader
        title="Home"
        lead="Pick up an episode, or find the next one on your list."
        hub={hub}
      />
      {settings?.appearance.homeBanner !== "none" &&
        (() => {
          const image =
            settings?.appearance.homeBanner === "custom"
              ? settings.appearance.bannerImage
                ? `vestra-media://appearance/bannerImage?v=${encodeURIComponent(settings.appearance.bannerImage)}`
                : null
              : (continueWatching.find((r) => r.item.isAdult !== true)?.item
                  .images.backdrop ??
                model.groups
                  .flatMap((g) => g.items)
                  .find(
                    (r) => r.item.isAdult !== true && r.item.images.backdrop,
                  )?.item.images.backdrop);
          return image ? (
            <div className="home-art-banner" aria-label="Home banner">
              <img src={image} alt="" />
            </div>
          ) : null;
        })()}
      {failure && (
        <div className="hub-notice" role="alert">
          <h2>Your lists could not be fully loaded</h2>
          <p>{failure.message}</p>
          <button
            onClick={() => {
              void watchlist.refetch();
              void history.refetch();
              void progress.refetch();
              void lists.refetch();
            }}
          >
            Retry lists
          </button>
        </div>
      )}
      {(controls.actions.error || controls.status.error) && (
        <p role="alert" className="hub-notice">
          {(controls.actions.error || controls.status.error)?.message}
        </p>
      )}
      <ContinueShelfNotice shelf={continueShelf} />
      <AnimeCarousel
        id="continue"
        title="Continue watching"
        loading={
          continueShelf.isPending ||
          loading ||
          (!failure && missingIds.length > 0 && recovery.isPending)
        }
        empty={
          !loading && !continueWatching.length ? (
            <div className="hub-empty">
              <h3>Ready when you are</h3>
              <p>
                Partially watched episodes appear here once you start watching.
              </p>
              <Link to={`/discover?source=${encodeURIComponent(hub.provider)}`}>
                Discover anime
              </Link>
            </div>
          ) : undefined
        }
      >
        {cards(continueWatching, true)}
      </AnimeCarousel>
      {model.groups.map(
        (group) =>
          (group.status === "watching" ||
            group.status === "planned" ||
            group.items.length > 0) && (
            <AnimeCarousel
              key={group.status}
              id={`list-${group.status}`}
              title={group.title}
              loading={loading}
              empty={
                !loading && !group.items.length ? (
                  <div className="hub-empty">
                    <p>
                      {group.status === "planned"
                        ? "Save an anime to Plan to watch, or add it to a playlist."
                        : "Change a saved title's status to Currently watching, or start an episode."}
                    </p>
                  </div>
                ) : undefined
              }
            >
              {cards(group.items)}
            </AnimeCarousel>
          ),
      )}
      {!!lists.data?.length && (
        <section className="hub-shelf">
          <h2>Your playlists</h2>
          <div className="hub-playlists">
            {lists.data.map((list) => (
              <Link
                key={list.id}
                to={`/anime?${new URLSearchParams({ view: "playlists", list: list.id, source: hub.provider })}`}
              >
                <strong>{list.name}</strong>
                <span>{list.items.length} titles</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {recovery.error && (
        <p role="status" className="hub-notice">
          Some older title information could not be restored.{" "}
          <button onClick={() => void recovery.refetch()}>
            Retry title lookup
          </button>
        </p>
      )}
      {untracked.some((row) => row.ref.source !== "anilist") && (
        <details className="hub-calendar-unmatched">
          <summary>Older source history needs title information</summary>
          <p>
            Reopen those titles from their streaming source once to restore
            their cards. Saved progress is retained.
          </p>
        </details>
      )}
      {controls.playlist}
    </div>
  );
}
