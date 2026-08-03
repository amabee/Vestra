import { anilist, tmdb } from "@vestra/api";
import { isTmdbConfigured } from "@vestra/config";
import type { Metadata } from "next";

import { MediaRow } from "@/components/media/media-row";

export const metadata: Metadata = { title: "Discover" };
export const revalidate = 3600;

/** Broad browse view combining popular titles from every configured source. */
export default async function DiscoverPage() {
  const tmdbReady = isTmdbConfigured();

  const [anime, movies, tv] = await Promise.all([
    anilist.getPopularAnime(1, 20).catch(() => []),
    tmdbReady ? tmdb.getPopularMovies().catch(() => []) : Promise.resolve([]),
    tmdbReady ? tmdb.getPopularTv().catch(() => []) : Promise.resolve([]),
  ]);

  const rows = [
    { id: "popular-anime", title: "Popular Anime", items: anime, href: "/anime" },
    { id: "popular-movies", title: "Popular Movies", items: movies, href: "/movies" },
    { id: "popular-tv", title: "Popular TV Shows", items: tv, href: "/tv" },
  ].filter((row) => row.items.length > 0);

  return (
    <div className="space-y-7 pb-8">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Discover</h1>
        <p className="text-[13px] text-muted-foreground">
          Popular across every connected source.
        </p>
      </div>

      {rows.map((row, index) => (
        <MediaRow
          key={row.id}
          title={row.title}
          items={row.items}
          href={row.href}
          index={index}
        />
      ))}
    </div>
  );
}
