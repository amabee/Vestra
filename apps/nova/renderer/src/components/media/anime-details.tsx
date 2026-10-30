import {
  preferredAnimeSource,
  rememberAnimeSource,
} from "./anime-source-preference";
import { PlaylistPicker } from "./playlist-picker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  mediaKey,
  parseMediaKey,
  mediaDetailsSchema,
  type MediaItem,
  type PlaybackSource,
  type WatchProgress,
} from "@vestra/types";
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  Check,
  ExternalLink,
  Film,
  Play,
  RotateCcw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { bridge } from "@/lib/bridge";
import { keys, useBookmarks, useProgress, useWatchlist } from "@/lib/queries";
import { usePlayer } from "@/lib/player-store";
import "./anime-details.css";

/** Dropdown value for the owned local files of this anime. */
const LOCAL_SOURCE = "local";

/** Dropdown value for the deep links to the provider's own pages. */
const LINK_SOURCE = "links";

export function AnimeDetails() {
  const { source, kind, id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const ref = parseMediaKey(`${source}:${kind}:${id}`);
  const identity = ref ? mediaKey(ref) : "";
  const extensions = useQuery({
    queryKey: ["anime-sources"],
    queryFn: bridge.anime.sources,
    refetchInterval: 5000,
  });
  const localFiles = useQuery({
    queryKey: ["anime-local-files", identity],
    queryFn: () => bridge.media.resolvePlayback(ref! as MediaItem, "builtin"),
    enabled: !!ref,
    staleTime: 30000,
    retry: false,
  });
  const localList = (localFiles.data ?? []).filter(
    (entry) => entry.kind === "file",
  );
  const linkList = (localFiles.data ?? []).filter(
    (entry) => entry.kind === "external",
  );
  const hasLocal = localList.length > 0;
  const hasLinks = linkList.length > 0;
  const selected =
    params.get("source") ?? preferredAnimeSource(extensions.data, hasLocal);
  const localMode = selected === LOCAL_SOURCE;
  const linkMode = selected === LINK_SOURCE;
  const available = extensions.data?.find((row) => row.id === selected);
  useEffect(() => {
    if (available || localMode) rememberAnimeSource(selected);
  }, [selected, available, localMode]);
  useEffect(() => {
    if (!params.get("source") && selected)
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("source", selected);
          return next;
        },
        { replace: true },
      );
  }, [params, selected, setParams]);
  const details = useQuery({
    queryKey: ["details", source, kind, id],
    queryFn: () => bridge.media.details(ref! as MediaItem),
    enabled: !!ref,
  });
  const episodes = useQuery({
    queryKey: ["anime-source-details", identity, selected],
    queryFn: () => bridge.anime.resolve(selected, ref!),
    enabled: !!ref && !!available,
    staleTime: 30000,
    gcTime: 0,
    retry: false,
  });
  const progress = useProgress();
  const bookmarks = useBookmarks();
  const watchlist = useWatchlist();
  const player = usePlayer();
  const [limit, setLimit] = useState(50);
  const [failedCovers, setFailedCovers] = useState<string[]>([]);
  const [saveDialog, setSaveDialog] = useState(false);
  const data =
    details.data ??
    (episodes.data?.item ? mediaDetailsSchema.parse(episodes.data.item) : null);
  const queue = localMode ? localList : (episodes.data?.queue ?? []);
  const query = params.get("episode") ?? "";
  const filter = params.get("filter") ?? "all";
  const descending = params.get("order") === "newest";
  const patch = (key: string, value: string) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
    setLimit(50);
  };
  const episodeId = (entry: PlaybackSource) =>
    entry.progressId ?? entry.fileId ?? null;
  const keyFor = (entry: PlaybackSource) => {
    const id = episodeId(entry);
    return id ? `${identity}#${id}` : identity;
  };
  const saved = (entry: PlaybackSource): WatchProgress | undefined =>
    progress.data?.[keyFor(entry)];
  const mark = useMutation({
    mutationFn: ({
      entry,
      watched,
    }: {
      entry: PlaybackSource;
      watched: boolean;
    }) =>
      bridge.progress.save({
        ref: ref!,
        episodeId: episodeId(entry),
        positionSeconds: watched ? saved(entry)?.durationSeconds || 1 : 0,
        durationSeconds: saved(entry)?.durationSeconds || 1,
      }),
    onSuccess: () => cache.invalidateQueries({ queryKey: keys.progress }),
  });
  const bookmark = useMutation({
    mutationFn: (entry: PlaybackSource) =>
      bridge.bookmarks.toggle({
        ref: ref!,
        episodeId: episodeId(entry),
      }),
    onSuccess: () => cache.invalidateQueries({ queryKey: keys.bookmarks }),
  });
  const inLibrary = watchlist.data?.some(
    (row) => mediaKey(row.ref) === identity,
  );
  const library = useMutation({
    mutationFn: () =>
      inLibrary
        ? bridge.watchlist.remove(ref!)
        : bridge.watchlist.add(data!, "planned"),
    onSuccess: () => cache.invalidateQueries({ queryKey: keys.watchlist }),
  });
  const play = (index: number, quality?: string, startAt?: number) => {
    const entry = queue[index];
    const item = localMode ? (data ?? ref) : episodes.data?.item;
    if (!item || !entry) return;
    player.open(
      item as MediaItem,
      queue,
      index,
      startAt ?? null,
      quality ? { [entry.locator]: quality } : {},
    );
  };
  const resumeIndex =
    queue
      .map((entry, index) => ({ index, watch: saved(entry) }))
      .filter(
        (row) => row.watch && !row.watch.completed && row.watch.percent >= 0.01,
      )
      .sort((a, b) => (b.watch?.updatedAt ?? 0) - (a.watch?.updatedAt ?? 0))[0]
      ?.index ?? -1;
  const first =
    resumeIndex >= 0
      ? resumeIndex
      : Math.max(
          0,
          queue.findIndex((entry) => !saved(entry)?.completed),
        );
  const selectedEntry =
    player.item && mediaKey(player.item) === identity
      ? player.queue[player.index]
      : null;
  const visible = queue
    .map((entry, index) => ({ entry, index }))
    .filter(
      ({ entry }) =>
        `${entry.episode ?? ""} ${entry.label ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (filter === "unwatched"
          ? !saved(entry)?.completed
          : filter === "bookmarked"
            ? !!bookmarks.data?.[keyFor(entry)]
            : true),
    );
  if (descending) visible.reverse();
  const artwork =
    episodes.data?.item.images.poster ?? data?.images.poster ?? null;
  const cover =
    artwork && !failedCovers.includes(artwork)
      ? artwork
      : data?.images.poster && !failedCovers.includes(data.images.poster)
        ? data.images.poster
        : null;
  const backdrop =
    [episodes.data?.item.images.backdrop, data?.images.backdrop].find(
      (url): url is string => !!url && !failedCovers.includes(url),
    ) ?? cover;
  const busy = !localMode && episodes.isFetching;
  const watchedCount = queue.filter((entry) => saved(entry)?.completed).length;

  if (!ref)
    return (
      <div className="anime-details">
        <p role="alert">This anime link is invalid.</p>
        <Link to="/anime">Browse anime</Link>
      </div>
    );

  return (
    <article className="anime-details">
      <nav className="anime-navigation" aria-label="Anime navigation">
        <button
          type="button"
          className="anime-text-button"
          onClick={() => void navigate(-1)}
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <Link to="/extensions">Manage extensions</Link>
      </nav>

      {saveDialog && data && (
        <PlaylistPicker
          item={data}
          provider={selected}
          onClose={() => setSaveDialog(false)}
        />
      )}
      <header className={`anime-hero${backdrop ? " anime-hero-backdrop" : ""}`}>
        <div className="anime-backdrop" aria-hidden="true">
          {backdrop ? (
            <img
              key={backdrop}
              src={backdrop}
              alt=""
              referrerPolicy="no-referrer"
              decoding="async"
              onError={() => setFailedCovers((values) => [...values, backdrop])}
            />
          ) : null}
        </div>
        <div className="anime-poster">
          {cover ? (
            <img
              key={cover}
              src={cover}
              width={400}
              height={600}
              alt=""
              referrerPolicy="no-referrer"
              decoding="async"
              onError={() => setFailedCovers((values) => [...values, cover])}
            />
          ) : (
            <div className="anime-cover-empty">
              <Film size={36} />
              <span>
                {details.isPending ? "Loading artwork…" : "Artwork unavailable"}
              </span>
            </div>
          )}
        </div>

        <div className="anime-introduction">
          {details.isPending ? (
            <div
              className="anime-skeleton anime-title-skeleton"
              role="status"
              aria-label="Loading anime information"
            />
          ) : (
            <h1>{data?.title ?? "Anime information unavailable"}</h1>
          )}
          {data?.originalTitle && data.originalTitle !== data.title && (
            <p className="anime-alternative">{data.originalTitle}</p>
          )}
          {details.error && (
            <div className="anime-message" role="alert">
              <p>{details.error.message}</p>
              <button type="button" onClick={() => void details.refetch()}>
                Retry information
              </button>
            </div>
          )}
          {data && (
            <dl className="anime-facts">
              {data.year && (
                <div>
                  <dt>Released</dt>
                  <dd>{data.year}</dd>
                </div>
              )}
              <div>
                <dt>Status</dt>
                <dd>{data.status.replaceAll("-", " ")}</dd>
              </div>
              {data.rating.score != null && (
                <div>
                  <dt>Rating</dt>
                  <dd>{data.rating.score}%</dd>
                </div>
              )}
              {!!data.studios.length && (
                <div>
                  <dt>Studio</dt>
                  <dd>{data.studios.join(", ")}</dd>
                </div>
              )}
            </dl>
          )}
          {!!data?.genres.length && (
            <ul className="anime-genres" aria-label="Genres">
              {data.genres.map((genre) => (
                <li key={genre.id}>{genre.name}</li>
              ))}
            </ul>
          )}
          {data?.overview && (
            <details className="anime-synopsis" open>
              <summary>Synopsis</summary>
              <p>{data.overview}</p>
            </details>
          )}
          <div className="anime-actions">
            <button
              type="button"
              className="anime-primary"
              disabled={!queue.length || busy || (!localMode && !available)}
              onClick={() =>
                play(
                  first,
                  undefined,
                  resumeIndex >= 0
                    ? Math.floor(saved(queue[first]!)?.positionSeconds ?? 0)
                    : 0,
                )
              }
            >
              <Play size={17} />
              {busy
                ? "Finding episodes…"
                : resumeIndex >= 0
                  ? `Resume episode ${queue[first]?.episode ?? first + 1}`
                  : `Play episode ${queue[first]?.episode ?? 1}`}
            </button>
            <button
              type="button"
              aria-pressed={!!inLibrary}
              disabled={library.isPending || !data}
              onClick={() => library.mutate()}
            >
              {inLibrary ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
              {inLibrary ? "Saved for later" : "Watch later"}
            </button>
            <button
              type="button"
              disabled={!data}
              onClick={() => setSaveDialog(true)}
            >
              Add to playlist
            </button>
          </div>
          {library.error && (
            <p role="alert" className="anime-error">
              {library.error.message}
            </p>
          )}
        </div>
      </header>

      <section
        className="anime-episodes"
        aria-labelledby="anime-episodes-title"
      >
        <div className="anime-episode-heading">
          <div>
            <h2 id="anime-episodes-title">Episodes</h2>
            <p>
              {queue.length
                ? `${queue.length} available, ${watchedCount} watched`
                : linkMode
                  ? "Open a link in your browser"
                  : "Choose a playback source to watch"}
            </p>
          </div>
          <label className="anime-source-label">
            Playback source
            <select
              aria-label="Streaming extension"
              value={selected}
              onChange={(event) => patch("source", event.target.value)}
              disabled={
                !hasLocal &&
                !hasLinks &&
                (extensions.isPending || !extensions.data?.length)
              }
            >
              {!selected && <option value="">No sources available</option>}
              {selected && !available && !localMode && !linkMode && (
                <option value={selected} disabled>
                  Selected source unavailable
                </option>
              )}
              {extensions.data?.map((extension) => (
                <option key={extension.id} value={extension.id}>
                  {extension.name}
                </option>
              ))}
              {hasLocal && <option value={LOCAL_SOURCE}>Local files</option>}
              {hasLinks && <option value={LINK_SOURCE}>Other links</option>}
            </select>
          </label>
        </div>

        {linkMode ? (
          <LinkList links={linkList} />
        ) : !localMode && extensions.isPending ? (
          <EpisodeSkeleton />
        ) : !localMode && extensions.error ? (
          <div className="anime-message" role="alert">
            <p>Extensions could not be loaded. {extensions.error.message}</p>
            <button type="button" onClick={() => void extensions.refetch()}>
              Retry extensions
            </button>
          </div>
        ) : !localMode && !extensions.data?.length ? (
          <div className="anime-message">
            <h3>No anime extensions enabled</h3>
            <p>Install or enable an anime extension to load episodes.</p>
            <Link to="/extensions">Open Extensions</Link>
          </div>
        ) : !localMode && !available ? (
          <div className="anime-message" role="alert">
            <p>
              This extension was disabled or removed. Select an available
              extension above.
            </p>
            <Link to="/extensions">Manage extensions</Link>
          </div>
        ) : !localMode && (episodes.isPending || busy) ? (
          <EpisodeSkeleton />
        ) : !localMode && episodes.error ? (
          <div className="anime-message" role="alert">
            <h3>Episodes could not be loaded</h3>
            <p>{episodes.error.message}</p>
            <button type="button" onClick={() => void episodes.refetch()}>
              Retry episodes
            </button>
          </div>
        ) : !localMode && !episodes.data ? (
          <div className="anime-message">
            <h3>No matching title on {available?.name ?? "this extension"}</h3>
            <p>
              This extension did not return a unique match for this anime.
              Choose another extension or search its titles.
            </p>
            <Link to={`/anime?${new URLSearchParams({ source: selected })}`}>
              Search this extension
            </Link>
          </div>
        ) : !queue.length ? (
          <div className="anime-message">
            <h3>
              {localMode
                ? "No local files for this anime"
                : "No episodes published by this extension"}
            </h3>
            <button
              type="button"
              onClick={() => void (localMode ? localFiles : episodes).refetch()}
            >
              {localMode ? "Refresh files" : "Refresh episodes"}
            </button>
          </div>
        ) : (
          <>
            {episodes.data?.providerTitle && (
              <p className="anime-provider-title">
                Listed as {episodes.data.providerTitle}
              </p>
            )}
            <div className="anime-toolbar">
              <label>
                Find episode
                <input
                  type="search"
                  value={query}
                  placeholder="Number or title"
                  onChange={(event) => patch("episode", event.target.value)}
                />
              </label>
              <label>
                Show
                <select
                  value={filter}
                  onChange={(event) => patch("filter", event.target.value)}
                >
                  <option value="all">All episodes</option>
                  <option value="unwatched">Unwatched</option>
                  <option value="bookmarked">Bookmarked</option>
                </select>
              </label>
              <label>
                Order
                <select
                  value={descending ? "newest" : "oldest"}
                  onChange={(event) =>
                    patch(
                      "order",
                      event.target.value === "newest" ? "newest" : "",
                    )
                  }
                >
                  <option value="oldest">First to last</option>
                  <option value="newest">Last to first</option>
                </select>
              </label>
            </div>

            {(mark.error || bookmark.error) && (
              <p role="alert" className="anime-error">
                {(mark.error ?? bookmark.error)?.message}
              </p>
            )}
            {(progress.error || bookmarks.error) && (
              <div className="anime-message" role="alert">
                <p>Saved episode status is unavailable.</p>
                <button
                  type="button"
                  onClick={() => {
                    void progress.refetch();
                    void bookmarks.refetch();
                  }}
                >
                  Retry saved status
                </button>
              </div>
            )}
            {visible.length === 0 ? (
              <div className="anime-message">
                <h3>No episodes match these filters</h3>
                <button
                  type="button"
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.delete("episode");
                    next.delete("filter");
                    setParams(next, { replace: true });
                    setLimit(50);
                  }}
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <ol className="anime-episode-list">
                {visible.slice(0, limit).map(({ entry, index }) => {
                  const watched = saved(entry)?.completed;
                  const current =
                    !!episodeId(entry) &&
                    !!selectedEntry &&
                    episodeId(selectedEntry) === episodeId(entry);
                  const isBookmarked = !!bookmarks.data?.[keyFor(entry)];
                  const number = entry.episode ?? index + 1;
                  return (
                    <li
                      key={entry.locator}
                      className={current ? "anime-episode-current" : ""}
                      aria-current={current ? "true" : undefined}
                    >
                      <span className="anime-episode-number">
                        {String(number).padStart(2, "0")}
                      </span>
                      <div className="anime-episode-name">
                        <h3>{entry.label ?? `Episode ${number}`}</h3>
                        <span>
                          {current
                            ? "Now playing"
                            : watched
                              ? "Watched"
                              : saved(entry)?.percent
                                ? "Continue watching"
                                : "Unwatched"}
                        </span>
                      </div>
                      <div className="anime-row-actions">
                        <button
                          type="button"
                          aria-label={`${isBookmarked ? "Remove bookmark for" : "Bookmark"} episode ${number}`}
                          aria-pressed={isBookmarked}
                          disabled={
                            bookmark.isPending ||
                            bookmarks.isPending ||
                            !!bookmarks.error
                          }
                          onClick={() => bookmark.mutate(entry)}
                        >
                          {isBookmarked ? (
                            <BookmarkCheck size={17} />
                          ) : (
                            <Bookmark size={17} />
                          )}
                        </button>
                        <button
                          type="button"
                          aria-label={`Mark episode ${number} ${watched ? "unwatched" : "watched"}`}
                          aria-pressed={!!watched}
                          disabled={
                            mark.isPending ||
                            progress.isPending ||
                            !!progress.error
                          }
                          onClick={() =>
                            mark.mutate({ entry, watched: !watched })
                          }
                        >
                          {watched ? (
                            <RotateCcw size={17} />
                          ) : (
                            <Check size={17} />
                          )}
                        </button>
                        <button
                          type="button"
                          className="anime-play-episode"
                          aria-label={`Play episode ${number}`}
                          onPointerEnter={() => {
                            if (entry.locator.startsWith("vestra-stream://"))
                              void bridge.media
                                .streamQualities(entry.locator)
                                .catch(() => undefined);
                          }}
                          onFocus={() => {
                            if (entry.locator.startsWith("vestra-stream://"))
                              void bridge.media
                                .streamQualities(entry.locator)
                                .catch(() => undefined);
                          }}
                          onClick={() => play(index)}
                        >
                          <Play size={15} />
                          <span>Play</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            {visible.length > limit && (
              <button
                type="button"
                className="anime-load-more"
                onClick={() => setLimit((value) => value + 50)}
              >
                Show more episodes ({visible.length - limit} remaining)
              </button>
            )}
          </>
        )}
      </section>
    </article>
  );
}

function LinkList({ links }: { links: PlaybackSource[] }) {
  return (
    <ol className="anime-episode-list">
      {links.map((link, index) => (
        <li key={link.locator}>
          <span className="anime-episode-number">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div className="anime-episode-name">
            <h3>{link.label ?? link.kind}</h3>
            <span>{link.kind}</span>
          </div>
          <div className="anime-row-actions">
            <button
              type="button"
              className="anime-play-episode"
              onClick={() => void bridge.shell.openExternal(link.locator)}
            >
              <ExternalLink size={15} />
              <span>Open</span>
            </button>
          </div>
        </li>
      ))}
    </ol>
  );
}

function EpisodeSkeleton() {
  return (
    <div className="anime-loading" role="status" aria-label="Loading episodes">
      {[0, 1, 2, 3].map((row) => (
        <div className="anime-skeleton" key={row} />
      ))}
      <span>Loading episodes…</span>
    </div>
  );
}
