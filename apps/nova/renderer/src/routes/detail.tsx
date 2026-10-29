import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDuration } from "@vestra/core/format";
import {
  mediaKey,
  parseMediaKey,
  type MediaItem,
  type MediaRef,
  type PlaybackSource,
  type WatchProgress,
} from "@vestra/types";
import {
  ArrowLeft,
  Bookmark,
  Check,
  ExternalLink,
  Loader2,
  Play,
  RotateCcw,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { Notice, Page, SectionRule } from "@/components/layout/page";
import { bridge } from "@/lib/bridge";
import { StreamQuality } from "@/components/player/stream-quality";
import { usePlayer } from "@/lib/player-store";
import {
  keys,
  useBookmarks,
  useLibrary,
  useLibraryUpdates,
  useProgress,
} from "@/lib/queries";

/** Below this an entry is an accidental open, not somewhere to return to. */
const MIN_PROGRESS = 0.01;

function isInAppPlayback(source: PlaybackSource): boolean {
  return source.kind === "file" || source.kind === "stream";
}

type EpisodeFilter = "all" | "unwatched" | "bookmarked";

interface EpisodeView {
  source: PlaybackSource;
  /** Index into the play queue — not the episode number. */
  index: number;
  /** Storage key shared by progress and bookmarks. */
  key: string;
  watch: WatchProgress | null;
  bookmarked: boolean;
  title: string;
  number: string;
  /** Runtime of the file itself, once it has been read. */
  runtimeSeconds: number | null;
  /** Still frame URL, or null until one has been taken. */
  still: string | null;
}

/**
 * Detail view.
 *
 * Reached from any catalogue row. The ref is carried in the URL rather than in
 * navigation state so a reload, or a link, resolves to the same page — state
 * would be gone on both.
 */
export function DetailRoute() {
  const { source, kind, id } = useParams();
  const navigate = useNavigate();
  const open = usePlayer((state) => state.open);

  const ref = parseMediaKey(`${source}:${kind}:${id}`);

  const details = useQuery({
    queryKey: ["details", source, kind, id],
    queryFn: () => bridge.media.details(ref as MediaItem),
    enabled: ref !== null,
  });

  const sources = useQuery({
    queryKey: ["playback", source, kind, id],
    queryFn: () => bridge.media.resolvePlayback(ref as MediaItem),
    enabled: ref !== null,
  });

  const start = useMutation({
    mutationFn: async (
      playback: PlaybackSource & { qualityLocator?: string },
    ) => {
      // Deep links belong in a browser; extension streams stay in the player.
      if (playback.kind === "external") {
        await bridge.shell.openExternal(playback.locator);
        return;
      }

      // Hand the player every in-app source, not just the chosen one, so it can
      // move to the next episode without coming back here for the list. The
      // adapter already returns them ordered by season and episode.
      const playable = (sources.data ?? []).filter(isInAppPlayback);
      const index = playable.findIndex(
        (source) => source.locator === playback.locator,
      );

      open(
        (details.data ?? ref) as MediaItem,
        playable.length > 0 ? playable : [playback],
        index < 0 ? 0 : index,
        null,
        playback.qualityLocator
          ? { [playback.locator]: playback.qualityLocator }
          : {},
      );
    },
  });

  /* ---------------------------------------------------------------------- *
   * Episodes
   * ---------------------------------------------------------------------- */

  const queryClient = useQueryClient();
  const progress = useProgress();
  const bookmarks = useBookmarks();
  const library = useLibrary();
  const [filter, setFilter] = useState<EpisodeFilter>("all");

  // Runtimes and stills are read in the background, so this page has to be
  // told when they land rather than only reading them once on mount.
  useLibraryUpdates();

  const baseKey = ref ? mediaKey(ref) : "";

  /**
   * Everything the list needs about each playable file, in one pass.
   *
   * Progress and bookmarks are stored under the same key, so they are looked
   * up together rather than threaded separately through the card.
   */
  const episodes = useMemo<EpisodeView[]>(() => {
    const local = (sources.data ?? []).filter(isInAppPlayback);

    // Real episode titles, where the provider has them. TMDb does; AniList
    // returns no per-episode data at all, so for anime this stays empty and
    // the generated "Ep 3" is what shows.
    const titles = new Map<string, string>();
    for (const season of details.data?.seasons ?? []) {
      for (const episode of season.episodes) {
        if (episode.title) {
          titles.set(
            `${season.seasonNumber}:${episode.episodeNumber}`,
            episode.title,
          );
        }
      }
    }

    // Runtime and still come from the library record rather than the playback
    // source: they are properties of the file, are filled in long after it was
    // indexed, and only local sources have them at all.
    const byFileId = new Map(
      (library.data ?? []).map((file) => [file.id, file]),
    );

    return local.map((entry, index) => {
      const key = entry.fileId ? `${baseKey}#${entry.fileId}` : baseKey;
      const named =
        entry.episode == null
          ? undefined
          : titles.get(`${entry.season ?? 1}:${entry.episode}`);

      const file = entry.fileId ? byFileId.get(entry.fileId) : undefined;

      return {
        source: entry,
        index,
        key,
        watch: progress.data?.[key] ?? null,
        bookmarked: bookmarks.data?.[key] !== undefined,
        title:
          named ??
          (entry.episode == null
            ? (entry.label ?? entry.fileName ?? "Untitled")
            : `Episode ${entry.episode}`),
        number: String(entry.episode ?? index + 1).padStart(2, "0"),
        runtimeSeconds: file?.durationSeconds ?? null,
        still:
          file?.thumbnailPath && entry.fileId
            ? `vestra-media://thumb/${encodeURIComponent(entry.fileId)}`
            : null,
      };
    });
  }, [
    sources.data,
    details.data,
    progress.data,
    bookmarks.data,
    library.data,
    baseKey,
  ]);

  const externals = (sources.data ?? []).filter(
    (entry) => entry.kind === "external",
  );

  /**
   * Where "Continue" goes.
   *
   * Whatever was left part-watched most recently, falling back to the first
   * episode not yet finished — which for an untouched series is episode one.
   */
  const resume = useMemo(() => {
    const started = episodes
      .filter(
        (entry) =>
          entry.watch &&
          !entry.watch.completed &&
          entry.watch.percent >= MIN_PROGRESS,
      )
      .sort((a, b) => (b.watch?.updatedAt ?? 0) - (a.watch?.updatedAt ?? 0));

    return (
      started[0] ?? episodes.find((entry) => !entry.watch?.completed) ?? null
    );
  }, [episodes]);

  const playEpisode = (
    entry: EpisodeView,
    startAt: number | null,
    qualityLocator?: string,
  ) => {
    open(
      (details.data ?? ref) as MediaItem,
      episodes.map((each) => each.source),
      entry.index,
      startAt,
      qualityLocator ? { [entry.source.locator]: qualityLocator } : {},
    );
  };

  const toggleBookmark = useMutation({
    mutationFn: (episodeId: string | null | undefined) =>
      bridge.bookmarks.toggle({
        ref: ref as MediaRef,
        episodeId: episodeId ?? null,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.bookmarks }),
  });

  /**
   * Mark an episode watched or unwatched by hand.
   *
   * Completion is derived from position over duration, so a runtime is needed.
   * The file's own runtime is used where it is known, falling back to whatever
   * playback last recorded, and finally to a single second — enough to set the
   * flag, and never shown, because a finished episode displays no time.
   */
  const setWatched = useMutation({
    mutationFn: async (input: { entry: EpisodeView; watched: boolean }) => {
      const seconds =
        input.entry.runtimeSeconds ?? input.entry.watch?.durationSeconds ?? 1;

      await bridge.progress.save({
        ref: ref as MediaRef,
        episodeId: input.entry.source.fileId,
        positionSeconds: input.watched ? seconds : 0,
        durationSeconds: seconds,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.progress }),
  });

  const visible = episodes.filter((entry) =>
    filter === "unwatched"
      ? !entry.watch?.completed
      : filter === "bookmarked"
        ? entry.bookmarked
        : true,
  );

  /**
   * Episodes grouped under their season.
   *
   * A library that has both seasons of a show matched to one entry would
   * otherwise show two runs of 01–12 with nothing to tell them apart, and the
   * season had to be repeated on every single row to compensate.
   */
  const groups = [
    ...visible
      .reduce((map, entry) => {
        const season = entry.source.season ?? 1;
        map.set(season, [...(map.get(season) ?? []), entry]);
        return map;
      }, new Map<number, EpisodeView[]>())
      .entries(),
  ]
    .sort(([a], [b]) => a - b)
    .map(([season, items]) => ({ season, items }));

  // Worth naming only when it is not simply "season one of one".
  const showSeasons = groups.length > 1 || (groups[0]?.season ?? 1) !== 1;

  // Somewhere to pick up from, as opposed to somewhere to start.
  const resumeFrom =
    resume?.watch &&
    !resume.watch.completed &&
    resume.watch.percent >= MIN_PROGRESS
      ? resume.watch
      : null;

  if (!ref) {
    return (
      <Page>
        <Notice
          title="Unreadable link"
          body="That media reference is not valid."
        />
      </Page>
    );
  }

  const data = details.data;
  const backdrop = data?.images.backdrop ?? null;
  const poster = data?.images.poster ?? null;

  return (
    <div>
      {/*
        One positioned block rather than a backdrop with the content dragged up
        over it by a negative margin. That arrangement had the poster and title
        clipping into the image with nothing sharing a baseline, so no amount of
        padding could line them up.
      */}
      <div className="relative">
        <div className="h-[22rem] w-full overflow-hidden bg-base-200">
          {backdrop ? (
            <img
              src={backdrop}
              alt=""
              referrerPolicy="no-referrer"
              className="size-full object-cover object-top opacity-50"
            />
          ) : null}
          {/* Vertical fade to the page colour, plus a lift from the left so
              bright artwork cannot swallow the title. */}
          <div className="absolute inset-0 bg-gradient-to-t from-base-100 via-base-100/85 to-base-100/20" />
          <div className="absolute inset-0 bg-gradient-to-r from-base-100/80 to-transparent" />
        </div>

        <button
          type="button"
          onClick={() => void navigate(-1)}
          className="absolute left-6 top-5 flex items-center gap-2 rounded-field border rule bg-base-100/70 px-3 py-1.5 text-xs backdrop-blur transition-colors hover:bg-base-200"
        >
          <ArrowLeft className="size-3.5" />
          Back
        </button>

        {/* Bottom-aligned, so poster and title share a baseline at any size. */}
        <div className="absolute inset-x-0 bottom-0 flex items-end gap-6 px-8 pb-8">
          <div className="aspect-[2/3] w-36 shrink-0 overflow-hidden rounded-box border rule bg-base-200 shadow-2xl">
            {poster ? (
              <img
                src={poster}
                alt=""
                referrerPolicy="no-referrer"
                className="size-full object-cover"
              />
            ) : null}
          </div>

          <div className="min-w-0 flex-1 pb-1">
            {details.isPending ? (
              <div className="h-14 w-2/3 animate-pulse rounded-selector bg-base-200" />
            ) : (
              <h1 className="font-serif text-display-lg text-balance">
                {data?.title ?? "Untitled"}
              </h1>
            )}

            {/* Surfaced rather than swallowed: a failed lookup used to render
                as a page titled "Unknown" with no explanation. */}
            {details.error ? (
              <p className="mt-2 text-xs text-error">
                {(details.error as Error).message}
              </p>
            ) : null}

            {data?.tagline ? (
              <p className="mt-1 font-serif text-display-sm italic text-base-content/50">
                {data.tagline}
              </p>
            ) : null}

            <MetaRow data={data} />
          </div>
        </div>
      </div>

      <div className="px-8 pb-12 pt-8">
        {data?.overview ? (
          <p
            data-selectable
            className="mt-8 max-w-[70ch] text-sm leading-relaxed text-base-content/70"
          >
            {data.overview}
          </p>
        ) : null}

        {data && data.genres.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {data.genres.map((genre) => (
              <span
                key={genre.id ?? genre.name}
                className="meta rounded-selector border rule px-2 py-0.5"
              >
                {genre.name}
              </span>
            ))}
          </div>
        ) : null}

        <section className="mt-10">
          <SectionRule
            label={episodes.length > 0 ? "Episodes" : "Play from"}
            count={sources.data?.length}
            trailing={
              episodes.length > 1 ? (
                <span className="meta">
                  {episodes.filter((entry) => entry.watch?.completed).length}{" "}
                  watched
                </span>
              ) : null
            }
          />

          {sources.isPending ? (
            <div className="py-6">
              <Loader2 className="size-5 animate-spin text-base-content/40" />
            </div>
          ) : sources.error ? (
            <Notice
              title="Could not resolve sources"
              body={(sources.error as Error).message}
            />
          ) : (sources.data ?? []).length === 0 ? (
            <>
              <Notice
                title="No matching playback source"
                body={
                  kind === "anime"
                    ? "The catalogue name may differ from your streaming provider's title, or the provider may not carry it."
                    : "Nothing you own or have configured can play this."
                }
              />
              {kind === "anime" && (
                <Link className="btn btn-primary mt-4" to="/anime">
                  Search your streaming sources
                </Link>
              )}
            </>
          ) : (
            <div>
              {episodes.length > 0 ? (
                <div className="mb-4 mt-4 flex flex-wrap items-center gap-3">
                  {resume ? (
                    <button
                      type="button"
                      onClick={() =>
                        playEpisode(
                          resume,
                          resumeFrom
                            ? Math.floor(resumeFrom.positionSeconds)
                            : 0,
                        )
                      }
                      className="flex items-center gap-2 rounded-field bg-primary px-4 py-2 text-xs font-medium text-primary-content transition-opacity hover:opacity-90"
                    >
                      <Play className="size-3.5 fill-current" />
                      <span>
                        {resumeFrom ? "Resume" : "Play"} {resume.title}
                      </span>
                      {resumeFrom ? (
                        <span className="opacity-70">
                          {formatDuration(
                            Math.max(
                              0,
                              resumeFrom.durationSeconds -
                                resumeFrom.positionSeconds,
                            ),
                          )}{" "}
                          left
                        </span>
                      ) : null}
                    </button>
                  ) : null}

                  {episodes.length > 1 ? (
                    <div className="flex items-center gap-1">
                      {(["all", "unwatched", "bookmarked"] as const).map(
                        (value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setFilter(value)}
                            className={`rounded-field border px-2.5 py-1 text-xs capitalize transition-colors ${
                              filter === value
                                ? "border-primary/50 bg-primary/10 text-primary"
                                : "rule text-base-content/60 hover:bg-base-200"
                            }`}
                          >
                            {value}
                          </button>
                        ),
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {episodes.length > 0 && visible.length === 0 ? (
                <Notice
                  title="Nothing here"
                  body={
                    filter === "bookmarked"
                      ? "No episodes bookmarked yet."
                      : "Every episode has been watched."
                  }
                />
              ) : null}

              <div className="space-y-5">
                {groups.map((group) => (
                  <div key={group.season} className="space-y-2">
                    {showSeasons ? (
                      <p className="meta pt-1">Season {group.season}</p>
                    ) : null}

                    {group.items.map((entry) => (
                      <EpisodeCard
                        key={entry.source.locator}
                        entry={entry}
                        busy={start.isPending}
                        onPlay={(startAt, qualityLocator) =>
                          playEpisode(entry, startAt, qualityLocator)
                        }
                        onBookmark={() =>
                          toggleBookmark.mutate(entry.source.fileId)
                        }
                        onWatched={(watched) =>
                          setWatched.mutate({ entry, watched })
                        }
                      />
                    ))}
                  </div>
                ))}
              </div>

              {/* Deep links out to the provider, kept plain — they are not
                  episodes and should not look like them. */}
              {externals.map((playback) => (
                <SourceRow
                  key={`${playback.kind}-${playback.locator}`}
                  playback={playback}
                  busy={start.isPending}
                  onPlay={(qualityLocator) =>
                    start.mutate({ ...playback, qualityLocator })
                  }
                />
              ))}
            </div>
          )}
        </section>

        {data && data.seasons.length > 0 ? (
          <section className="mt-10">
            {/* The provider's full listing, including episodes with no local
                file. Named apart from the playable list above so the page does
                not carry two headings that both say "Episodes". */}
            <SectionRule label="All episodes" />
            {data.seasons.map((season) => (
              <div key={season.id} className="mt-4">
                <p className="meta mb-1">
                  Season {season.seasonNumber} · {season.episodes.length}{" "}
                  episodes
                </p>
                {season.episodes.map((episode) => (
                  <div
                    key={episode.id}
                    className="grid grid-cols-[3rem_1fr_auto] items-center gap-4 border-b rule px-2 py-2.5"
                  >
                    <span className="index-mark text-right tabular-nums">
                      {String(episode.episodeNumber).padStart(2, "0")}
                    </span>
                    <span className="truncate text-sm">
                      {episode.title ?? `Episode ${episode.episodeNumber}`}
                    </span>
                    <span className="meta">
                      {episode.durationSeconds
                        ? formatDuration(episode.durationSeconds)
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function MetaRow({
  data,
}: {
  data:
    | {
        year: number | null;
        isSeries: boolean;
        rating: { score: number | null };
        certification: string | null;
        studios: string[];
      }
    | null
    | undefined;
}) {
  if (!data) return null;

  const parts: string[] = [];
  if (data.year) parts.push(String(data.year));
  parts.push(data.isSeries ? "Series" : "Film");
  if (data.rating.score !== null)
    parts.push(`${Math.round(data.rating.score)}%`);
  if (data.certification) parts.push(data.certification);
  if (data.studios[0]) parts.push(data.studios[0]);

  return <p className="meta mt-3">{parts.join(" · ")}</p>;
}

/**
 * One playable episode.
 *
 * A card rather than a table row: an episode carries more than a name now —
 * how far in you are, whether it is finished, whether you flagged it — and
 * those do not fit on one line without becoming a wall of text.
 */
function EpisodeCard({
  entry,
  busy,
  onPlay,
  onBookmark,
  onWatched,
}: {
  entry: EpisodeView;
  busy: boolean;
  onPlay: (startAt: number | null, qualityLocator?: string) => void;
  onBookmark: () => void;
  onWatched: (watched: boolean) => void;
}) {
  const { watch } = entry;
  const watched = watch?.completed ?? false;
  const partial = Boolean(watch && !watched && watch.percent >= MIN_PROGRESS);
  const remaining = watch
    ? Math.max(0, watch.durationSeconds - watch.positionSeconds)
    : 0;

  return (
    <article
      className={`group flex items-center gap-4 rounded-box border px-4 py-3 transition-colors ${
        watched ? "rule bg-base-200/20" : "rule bg-base-200/40"
      } hover:border-primary/40 hover:bg-base-200/70`}
    >
      {/* The still replaces the index once one exists, so the row keeps its
          shape whether or not the file has been read yet. */}
      <div className="relative w-24 shrink-0 overflow-hidden rounded-selector bg-base-300">
        <div className="aspect-video">
          {entry.still ? (
            <img
              src={entry.still}
              alt=""
              loading="lazy"
              className={`size-full object-cover ${watched ? "opacity-50" : ""}`}
            />
          ) : (
            <span
              className={`index-mark grid size-full place-items-center tabular-nums ${
                watched ? "text-base-content/25" : "text-base-content/50"
              }`}
            >
              {entry.number}
            </span>
          )}
        </div>

        {entry.still ? (
          <span className="absolute left-1 top-1 rounded-selector bg-base-100/80 px-1 text-[10px] font-mono tabular-nums text-base-content/70">
            {entry.number}
          </span>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p
            className={`truncate text-sm ${watched ? "text-base-content/50" : ""}`}
          >
            {entry.title}
          </p>
          {watched ? (
            <Check className="size-3.5 shrink-0 text-success" />
          ) : null}
          {entry.bookmarked ? (
            <Bookmark className="size-3.5 shrink-0 fill-current text-primary" />
          ) : null}
          {entry.runtimeSeconds ? (
            <span className="meta shrink-0">
              {formatDuration(entry.runtimeSeconds)}
            </span>
          ) : null}
        </div>

        {entry.source.fileName && entry.source.fileName !== entry.title ? (
          <p className="filename truncate" title={entry.source.fileName}>
            {entry.source.fileName}
          </p>
        ) : null}

        {partial ? (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-base-content/10">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.round((watch?.percent ?? 0) * 100)}%` }}
              />
            </div>
            <span className="meta shrink-0">
              {formatDuration(remaining)} left
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <StreamQuality
          locator={entry.source.locator}
          busy={busy}
          onSelect={(choice) =>
            onPlay(
              partial ? Math.floor(watch?.positionSeconds ?? 0) : 0,
              choice,
            )
          }
        />
        <CardAction
          label={
            entry.bookmarked
              ? `Remove bookmark from ${entry.title}`
              : `Bookmark ${entry.title}`
          }
          active={entry.bookmarked}
          onClick={onBookmark}
        >
          <Bookmark
            className={`size-4 ${entry.bookmarked ? "fill-current" : ""}`}
          />
        </CardAction>

        <CardAction
          label={
            watched
              ? `Mark ${entry.title} unwatched`
              : `Mark ${entry.title} watched`
          }
          active={watched}
          onClick={() => onWatched(!watched)}
        >
          <Check className="size-4" />
        </CardAction>

        {partial ? (
          <CardAction
            label={`Start ${entry.title} over`}
            onClick={() => onPlay(0)}
          >
            <RotateCcw className="size-4" />
          </CardAction>
        ) : null}

        <button
          type="button"
          disabled={busy}
          aria-label={`${partial ? "Resume" : "Play"} ${entry.title}`}
          onClick={() =>
            onPlay(partial ? Math.floor(watch?.positionSeconds ?? 0) : 0)
          }
          className="ml-1 flex items-center gap-2 rounded-field border border-primary/40 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-primary hover:text-primary-content"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5 fill-current" />
          )}
          {partial ? "Resume" : "Play"}
        </button>
      </div>
    </article>
  );
}

/** A small square icon control on an episode card. */
function CardAction({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`grid size-8 place-items-center rounded-field transition-colors ${
        active
          ? "text-primary hover:bg-primary/10"
          : "text-base-content/35 hover:bg-base-200 hover:text-base-content/80"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * One playable source.
 *
 * Adapters are already ranked by priority in the registry — an owned local file
 * outranks a licensed stream, which outranks an external link — so the order
 * here is meaningful and is left alone.
 */
function SourceRow({
  playback,
  index,
  busy,
  onPlay,
}: {
  playback: PlaybackSource;
  index?: number;
  busy: boolean;
  onPlay: (qualityLocator?: string) => void;
}) {
  const external = playback.locator.startsWith("http");

  return (
    <div className="group flex items-center gap-4 border-b rule px-2 py-3 transition-colors hover:bg-base-200/50">
      {index !== undefined ? (
        <span className="index-mark w-8 shrink-0 text-right tabular-nums">
          {String(index + 1).padStart(2, "0")}
        </span>
      ) : null}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{playback.label ?? playback.kind}</p>
        <p className="meta">
          {playback.kind}
          {playback.mimeType ? ` · ${playback.mimeType}` : ""}
        </p>
      </div>

      <StreamQuality locator={playback.locator} busy={busy} onSelect={onPlay} />
      <button
        type="button"
        disabled={busy}
        onClick={() => onPlay()}
        className="flex items-center gap-2 rounded-field border border-primary/40 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-primary hover:text-primary-content"
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : external ? (
          <ExternalLink className="size-3.5" />
        ) : (
          <Play className="size-3.5 fill-current" />
        )}
        {external ? "Open" : "Play"}
      </button>
    </div>
  );
}
