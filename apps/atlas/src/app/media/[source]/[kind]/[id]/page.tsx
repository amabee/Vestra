import { formatDuration, formatRating } from "@vestra/core/format";
import { mediaKindSchema, mediaSourceSchema } from "@vestra/types";
import { Badge, Button, GlassCard, MediaCard } from "@vestra/ui";
import { ExternalLink, Play, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { WatchlistButton } from "@/components/media/watchlist-button";
import { YoutubePlayer } from "@/components/media/youtube-player";
import { getMediaDetails } from "@/lib/media";
import { mediaHref } from "@/lib/routes";

interface PageProps {
  // Next 16 delivers route params asynchronously.
  params: Promise<{ source: string; kind: string; id: string }>;
}

/** Validate the dynamic segments before touching any provider. */
async function resolveParams(params: PageProps["params"]) {
  const { source, kind, id } = await params;

  const parsedSource = mediaSourceSchema.safeParse(source);
  const parsedKind = mediaKindSchema.safeParse(kind);
  if (!parsedSource.success || !parsedKind.success) return null;

  return { source: parsedSource.data, kind: parsedKind.data, id: decodeURIComponent(id) };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolved = await resolveParams(params);
  if (!resolved) return { title: "Not found" };

  try {
    const details = await getMediaDetails(resolved.source, resolved.kind, resolved.id);
    if (!details) return { title: "Not found" };

    return {
      title: details.title,
      description: details.overview ?? undefined,
    };
  } catch {
    return { title: "Vestra" };
  }
}

export default async function MediaDetailsPage({ params }: PageProps) {
  const resolved = await resolveParams(params);
  if (!resolved) notFound();

  const details = await getMediaDetails(resolved.source, resolved.kind, resolved.id).catch(
    () => null,
  );
  if (!details) notFound();

  const rating = formatRating(details.rating.score);
  const runtime = formatDuration(details.durationSeconds);
  const isYoutube = details.kind === "youtube-video";

  return (
    <article className="pb-12">
      {/* Backdrop */}
      {details.images.backdrop ? (
        <div className="relative -mx-6 -mt-6 h-[42vh] min-h-64 overflow-hidden">
          <img
            src={details.images.backdrop}
            alt=""
            className="size-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/20" />
        </div>
      ) : null}

      <div
        className={
          details.images.backdrop
            ? "relative -mt-40 flex flex-col gap-8 md:flex-row"
            : "flex flex-col gap-8 md:flex-row"
        }
      >
        {/* Poster */}
        <div className="w-44 shrink-0 sm:w-52">
          <div className="overflow-hidden rounded-2xl shadow-lifted">
            {details.images.poster ? (
              <img
                src={details.images.poster}
                alt=""
                className="aspect-[2/3] w-full object-cover"
              />
            ) : (
              <div className="flex aspect-[2/3] w-full items-center justify-center bg-secondary p-4 text-center text-xs text-muted-foreground">
                {details.title}
              </div>
            )}
          </div>
        </div>

        {/* Meta */}
        <div className="min-w-0 flex-1 space-y-4 pt-2">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">{details.title}</h1>
            {details.originalTitle ? (
              <p className="text-sm text-muted-foreground">{details.originalTitle}</p>
            ) : null}
            {details.tagline ? (
              <p className="text-sm italic text-muted-foreground">{details.tagline}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {rating ? (
              <span className="flex items-center gap-1 font-medium text-foreground">
                <Star className="size-3.5 fill-amber-400 text-amber-400" />
                {rating}
              </span>
            ) : null}
            {details.year ? <span>{details.year}</span> : null}
            {runtime ? <span>{runtime}</span> : null}
            {details.status !== "unknown" ? (
              <Badge variant="outline" className="capitalize">
                {details.status}
              </Badge>
            ) : null}
          </div>

          {details.genres.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {details.genres.map((genre) => (
                <Badge key={genre.id} variant="secondary">
                  {genre.name}
                </Badge>
              ))}
            </div>
          ) : null}

          {details.overview ? (
            <p className="max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {details.overview}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            {isYoutube ? null : (
              <Button variant="default">
                <Play className="size-4 fill-current" />
                Play
              </Button>
            )}
            <WatchlistButton item={details} />
            {details.sourceUrl ? (
              <Button asChild variant="outline">
                <a href={details.sourceUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4" />
                  Open in source
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {/* YouTube gets an inline embedded player. */}
      {isYoutube ? (
        <section className="mt-10">
          <YoutubePlayer videoId={details.sourceId} title={details.title} />
        </section>
      ) : null}

      {/* Cast */}
      {details.cast.length > 0 ? (
        <section className="mt-10 space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Cast</h2>
          <div className="row-scroller flex gap-4 overflow-x-auto pb-2">
            {details.cast.map((person) => (
              <div key={person.id} className="w-24 shrink-0 text-center">
                <div className="mx-auto size-20 overflow-hidden rounded-full bg-secondary">
                  {person.image ? (
                    <img
                      src={person.image}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : null}
                </div>
                <p className="mt-2 truncate text-xs font-medium">{person.name}</p>
                {person.role ? (
                  <p className="truncate text-[11px] text-muted-foreground">{person.role}</p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Seasons & episodes */}
      {details.seasons.length > 0 ? (
        <section className="mt-10 space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Episodes</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {details.seasons.map((season) => (
              <GlassCard key={season.id} className="p-4">
                <p className="text-sm font-medium">
                  {season.title ?? `Season ${season.seasonNumber}`}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {season.episodeCount} episode{season.episodeCount === 1 ? "" : "s"}
                </p>
              </GlassCard>
            ))}
          </div>
        </section>
      ) : null}

      {/* Related */}
      {details.related.length > 0 ? (
        <section className="mt-10 space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Related</h2>
          <div className="row-scroller flex gap-4 overflow-x-auto pb-2">
            {details.related.map((item) => (
              <div
                key={`${item.source}-${item.kind}-${item.sourceId}`}
                className="w-36 shrink-0 sm:w-40"
              >
                <MediaCard item={item} href={mediaHref(item)} linkComponent={Link} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}
