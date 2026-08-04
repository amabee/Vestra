import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDuration } from "@vestra/core/format";
import { parseMediaKey, type MediaItem, type PlaybackSource } from "@vestra/types";
import { ArrowLeft, ExternalLink, Loader2, Play } from "lucide-react";
import { useNavigate, useParams } from "react-router";

import { Notice, Page, SectionRule } from "@/components/layout/page";
import { bridge } from "@/lib/bridge";
import { usePlayer } from "@/lib/player-store";

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
    mutationFn: async (playback: PlaybackSource) => {
      // Anything web-hosted belongs in a browser; only files Vestra can serve
      // itself go to the in-app player.
      if (playback.locator.startsWith("https://") || playback.locator.startsWith("http://")) {
        await bridge.shell.openExternal(playback.locator);
        return;
      }

      // Hand the player every local source, not just the chosen one, so it can
      // move to the next episode without coming back here for the list. The
      // adapter already returns them ordered by season and episode.
      const local = (sources.data ?? []).filter(
        (source) => !source.locator.startsWith("http"),
      );
      const index = local.findIndex((source) => source.locator === playback.locator);

      open(
        (details.data ?? ref) as MediaItem,
        local.length > 0 ? local : [playback],
        index < 0 ? 0 : index,
      );
    },
  });

  if (!ref) {
    return (
      <Page>
        <Notice title="Unreadable link" body="That media reference is not valid." />
      </Page>
    );
  }

  const data = details.data;
  const backdrop = data?.images.backdrop ?? null;
  const poster = data?.images.poster ?? null;

  // The matched-local adapter returns one source per file, already ordered by
  // season and episode, so more than one source means this is a series.
  const multiple = (sources.data ?? []).length > 1;

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
            label={multiple ? "Episodes" : "Play from"}
            count={sources.data?.length}
            trailing={
              multiple ? <span className="meta">choose one</span> : null
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
            <Notice
              title="No source available"
              body="Nothing you own or have configured can play this."
            />
          ) : (
            <div>
              {(sources.data ?? []).map((playback, index) => (
                <SourceRow
                  key={`${playback.kind}-${playback.locator}`}
                  playback={playback}
                  index={multiple ? index : undefined}
                  busy={start.isPending}
                  onPlay={() => start.mutate(playback)}
                />
              ))}
            </div>
          )}
        </section>

        {data && data.seasons.length > 0 ? (
          <section className="mt-10">
            <SectionRule label="Episodes" />
            {data.seasons.map((season) => (
              <div key={season.id} className="mt-4">
                <p className="meta mb-1">
                  Season {season.seasonNumber} · {season.episodes.length} episodes
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

function MetaRow({ data }: { data: { year: number | null; isSeries: boolean; rating: { score: number | null }; certification: string | null; studios: string[] } | null | undefined }) {
  if (!data) return null;

  const parts: string[] = [];
  if (data.year) parts.push(String(data.year));
  parts.push(data.isSeries ? "Series" : "Film");
  if (data.rating.score !== null) parts.push(`${Math.round(data.rating.score)}%`);
  if (data.certification) parts.push(data.certification);
  if (data.studios[0]) parts.push(data.studios[0]);

  return <p className="meta mt-3">{parts.join(" · ")}</p>;
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
  onPlay: () => void;
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

      <button
        type="button"
        disabled={busy}
        onClick={onPlay}
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
