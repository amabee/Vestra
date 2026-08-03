import { getTrendingByKind } from "@vestra/core/discover";
import type { Metadata } from "next";

import { MediaRow } from "@/components/media/media-row";
import { getProviderRegistry } from "@/lib/registry";

export const metadata: Metadata = { title: "Discover" };
export const dynamic = "force-dynamic";

/** Broad browse view, one row per content kind, merged across providers. */
export default async function DiscoverPage() {
  const providers = getProviderRegistry();

  const [anime, movies, tv, kdrama] = await Promise.all([
    getTrendingByKind(providers, "anime", 20),
    getTrendingByKind(providers, "movie", 20),
    getTrendingByKind(providers, "tv", 20),
    getTrendingByKind(providers, "kdrama", 20),
  ]);

  const rows = [
    { id: "anime", title: "Anime", items: anime.items, href: "/anime" },
    { id: "movies", title: "Movies", items: movies.items, href: "/movies" },
    { id: "tv", title: "TV Shows", items: tv.items, href: "/tv" },
    { id: "kdrama", title: "K-Drama", items: kdrama.items, href: "/kdrama" },
  ].filter((row) => row.items.length > 0);

  return (
    <div className="space-y-7 pb-8">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Discover</h1>
        <p className="text-[13px] text-muted-foreground">
          Trending across every connected source.
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
