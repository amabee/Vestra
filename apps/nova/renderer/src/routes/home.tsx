import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { mediaKey, type MediaItem, type WatchlistStatus } from "@vestra/types";
import { bridge } from "@/lib/bridge";
import { useWatchlist, useHistory, useProgress } from "@/lib/queries";
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
  const hub = useAnimeHub(),
    controls = useAnimeHubActions(hub.provider);
  const watchlist = useWatchlist(),
    history = useHistory(),
    progress = useProgress();
  const lists = useQuery({
    queryKey: playlistKey,
    queryFn: bridge.playlists.list,
  });
  const model = animeHomeModel(
    watchlist.data ?? [],
    history.data ?? [],
    lists.data ?? [],
    progress.data ?? {},
  );
  const loading =
    watchlist.isPending ||
    history.isPending ||
    progress.isPending ||
    lists.isPending;
  const failure =
    watchlist.error || history.error || progress.error || lists.error;
  const cards = (
    rows: {
      item: MediaItem;
      status: WatchlistStatus;
      progress?: { percent: number };
    }[],
    resume = false,
  ) =>
    rows.map((row) => (
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
      <AnimeCarousel
        id="continue"
        title="Continue watching"
        loading={loading}
        empty={
          !loading && !model.continueWatching.length ? (
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
        {cards(model.continueWatching, true)}
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
      {controls.playlist}
    </div>
  );
}
