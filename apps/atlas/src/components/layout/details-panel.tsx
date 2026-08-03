"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDuration, formatRating, formatVotes } from "@vestra/core/format";
import type { MediaDetails, MediaItem, WatchlistEntry } from "@vestra/types";
import { Badge, SourceBadge, cn } from "@vestra/ui";
import {
  BookmarkCheck,
  Check,
  ExternalLink,
  Info,
  LoaderCircle,
  Play,
  Plus,
  Star,
  X,
} from "lucide-react";
import Link from "next/link";

import { mediaHref } from "@/lib/routes";
import { toast } from "@/components/ui/toaster";
import { useUiStore } from "@/stores/ui-store";

/**
 * Right-hand details panel.
 *
 * Renders instantly from the selected MediaItem, then enriches with the full
 * MediaDetails payload (studios, seasons) once it arrives — so selecting a card
 * never shows a spinner in place of content the app already has.
 */

async function fetchDetails(item: MediaItem): Promise<MediaDetails> {
  const response = await fetch(
    `/api/media/${item.source}/${item.kind}/${encodeURIComponent(item.sourceId)}`,
  );
  if (!response.ok) throw new Error("Could not load details");
  const payload = (await response.json()) as { details: MediaDetails };
  return payload.details;
}

function MetaBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="text-[13px] leading-relaxed">{value}</p>
    </div>
  );
}

export function DetailsPanel() {
  const item = useUiStore((state) => state.selectedMedia);
  const setSelectedMedia = useUiStore((state) => state.setSelectedMedia);
  const openPlayer = useUiStore((state) => state.openPlayer);
  const queryClient = useQueryClient();

  const { data: details } = useQuery({
    queryKey: ["media-details", item?.source, item?.kind, item?.sourceId],
    queryFn: () => fetchDetails(item as MediaItem),
    enabled: item !== null,
    staleTime: 5 * 60_000,
  });

  const { data: watchlist } = useQuery({
    queryKey: ["watchlist"],
    queryFn: async () => {
      const response = await fetch("/api/watchlist");
      if (!response.ok) throw new Error("Could not load watchlist");
      return (await response.json()) as { entries: WatchlistEntry[] };
    },
  });

  const toggleWatchlist = useMutation({
    mutationFn: async (target: MediaItem) => {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
      });
      if (!response.ok) throw new Error("Could not update watchlist");
      return (await response.json()) as { inWatchlist: boolean };
    },
    onSuccess: (result) => {
      toast(
        result.inWatchlist ? "Added to your watchlist" : "Removed from your watchlist",
      );
      void queryClient.invalidateQueries({ queryKey: ["watchlist"] });
    },
    onError: () => toast("Could not update your watchlist", "error"),
  });

  if (!item) {
    // AppShell only mounts the panel when something is selected; this is a guard.
    return null;
  }

  // Prefer enriched values, fall back to what the card already gave us.
  const merged = details ?? item;
  const rating = formatRating(merged.rating.score);
  const votes = formatVotes(merged.rating.votes);
  const runtime = formatDuration(merged.durationSeconds);
  const poster = merged.images.poster ?? merged.images.thumbnail;

  const inWatchlist =
    watchlist?.entries.some(
      (entry) =>
        entry.ref.source === item.source &&
        entry.ref.kind === item.kind &&
        entry.ref.sourceId === item.sourceId,
    ) ?? false;

  const seasonCount = details?.seasons.length ?? 0;
  const studios = details?.studios ?? [];

  const metaLine = [
    merged.year,
    merged.isSeries && seasonCount > 0
      ? `${seasonCount} Season${seasonCount === 1 ? "" : "s"}`
      : runtime,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      {/* Below xl the panel floats over the content, so it needs a scrim. */}
      <button
        type="button"
        aria-label="Close details"
        onClick={() => setSelectedMedia(null)}
        className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm xl:hidden"
      />

      <aside
        className={cn(
          "z-40 w-72 shrink-0 overflow-y-auto border-l border-border/60 bg-sidebar",
          "fixed inset-y-0 right-0 shadow-lifted",
          "xl:static xl:z-auto xl:bg-sidebar/40 xl:shadow-none",
          "animate-in slide-in-from-right-4 duration-200 xl:animate-none",
        )}
      >
      <div className="relative space-y-4 p-4">
        <button
          type="button"
          onClick={() => setSelectedMedia(null)}
          aria-label="Close details"
          className="absolute right-5 top-5 z-10 flex size-7 items-center justify-center rounded-lg bg-black/50 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white"
        >
          <X className="size-3.5" />
        </button>

        <div className="overflow-hidden rounded-xl bg-surface-raised shadow-lifted">
          {poster ? (
            <img
              src={poster}
              alt=""
              className={cn(
                "w-full object-cover",
                merged.kind === "youtube-video" ? "aspect-video" : "aspect-[2/3]",
              )}
            />
          ) : (
            <div className="flex aspect-[2/3] items-center justify-center p-4 text-center text-xs text-muted-foreground">
              {merged.title}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <h2 className="text-[17px] font-semibold leading-tight">{merged.title}</h2>
          {metaLine ? (
            <p className="text-[12px] text-muted-foreground">{metaLine}</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-1.5">
            <SourceBadge kind={merged.kind} />
            {details?.certification ? (
              <Badge variant="outline">{details.certification}</Badge>
            ) : null}
            {merged.status !== "unknown" ? (
              <Badge variant="outline" className="capitalize">
                {merged.status}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => openPlayer(item)}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[13px] font-medium text-primary-foreground shadow-soft transition-all duration-200 hover:bg-primary/90 hover:shadow-glow-violet active:scale-[0.98]"
          >
            <Play className="size-3.5 fill-current" />
            Play
          </button>

          <button
            type="button"
            onClick={() => toggleWatchlist.mutate(item)}
            disabled={toggleWatchlist.isPending}
            aria-pressed={inWatchlist}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-secondary text-[13px] font-medium transition-colors hover:bg-secondary/70 active:scale-[0.98] disabled:opacity-60"
          >
            {toggleWatchlist.isPending ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : inWatchlist ? (
              <BookmarkCheck className="size-3.5" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {inWatchlist ? "In Watchlist" : "Add to Watchlist"}
          </button>

          <button
            type="button"
            className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-secondary text-[13px] font-medium transition-colors hover:bg-secondary/70 active:scale-[0.98]"
          >
            <Check className="size-3.5" />
            Mark as Watched
          </button>
        </div>

        {merged.overview ? (
          <p className="line-clamp-6 text-[12px] leading-relaxed text-muted-foreground">
            {merged.overview}
          </p>
        ) : null}

        <div className="space-y-3 border-t border-border/60 pt-3">
          {details && details.streaming.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground">Watch on</p>

              <div className="flex flex-col gap-1.5">
                {details.streaming.slice(0, 6).map((link) => (
                  <a
                    key={`${link.service}-${link.url}`}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-lg bg-secondary/50 px-2.5 py-2 transition-colors hover:bg-secondary"
                  >
                    {link.logo ? (
                      <img
                        src={link.logo}
                        alt=""
                        loading="lazy"
                        className="size-5 shrink-0 rounded"
                      />
                    ) : (
                      <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/20 text-[9px] font-bold">
                        {link.service.slice(0, 1)}
                      </span>
                    )}

                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                      {link.service}
                    </span>

                    {link.access !== "unknown" ? (
                      <span className="shrink-0 text-[10px] capitalize text-muted-foreground">
                        {link.access}
                      </span>
                    ) : null}

                    <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                  </a>
                ))}
              </div>

              {/* TMDb's availability data is licensed from JustWatch and
                  attribution is required by their terms. */}
              {details.streaming.some((link) => link.region !== null) ? (
                <p className="text-[10px] text-muted-foreground/70">
                  Availability data by JustWatch via TMDb
                </p>
              ) : null}
            </div>
          ) : null}

          {details && details.cast.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground">Cast</p>
              <div className="no-scrollbar -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1">
                {details.cast.slice(0, 12).map((person) => (
                  <div key={person.id} className="w-12 shrink-0 text-center">
                    <div className="mx-auto size-12 overflow-hidden rounded-full bg-secondary">
                      {person.image ? (
                        <img
                          src={person.image}
                          alt=""
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-[10px] leading-tight" title={person.name}>
                      {person.name}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {details && details.seasons.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium text-muted-foreground">Seasons</p>
              <div className="space-y-1">
                {details.seasons.slice(0, 8).map((season) => (
                  <div
                    key={season.id}
                    className="flex items-center justify-between rounded-md bg-secondary/40 px-2 py-1.5"
                  >
                    <span className="truncate text-[12px]">
                      {season.title ?? `Season ${season.seasonNumber}`}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {season.episodeCount} ep
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {merged.genres.length > 0 ? (
            <MetaBlock
              label="Genres"
              value={merged.genres.map((genre) => genre.name).join(", ")}
            />
          ) : null}

          {studios.length > 0 ? (
            <MetaBlock label="Studio" value={studios.join(", ")} />
          ) : null}

          {rating ? (
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">Rating</p>
              <p className="flex items-center gap-1.5 text-[13px]">
                <Star className="size-3.5 fill-amber-400 text-amber-400" />
                <span className="font-semibold">{rating}</span>
                {votes ? (
                  <span className="text-muted-foreground">({votes})</span>
                ) : null}
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
          <Link
            href={mediaHref(item)}
            className="flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Info className="size-3.5" />
            View full details
          </Link>

          {merged.sourceUrl ? (
            <a
              href={merged.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
              Open in source
            </a>
          ) : null}
        </div>
      </div>
    </aside>
    </>
  );
}
