import { trendingAcrossProviders, type ProviderRegistry } from "@vestra/provider-sdk";
import { recentlyAddedLocal } from "@vestra/providers/local-library";
import { getLocalFiles, type StorageDriver } from "@vestra/storage";
import type { DiscoverRow, DiscoverRowId, MediaItem, MediaKind } from "@vestra/types";

import { getContinueWatching, toContinueWatchingRow } from "./continue-watching";

/**
 * Home page composition.
 *
 * Trending rows come from the provider registry rather than a fixed list of API
 * calls, so a newly registered provider contributes automatically. Every row is
 * failure-isolated by the SDK: a dead provider yields an empty row, not an error
 * page.
 */

interface TrendingRowSpec {
  id: DiscoverRowId;
  kind: MediaKind;
  title: string;
  href: string;
}

const TRENDING_ROWS: readonly TrendingRowSpec[] = [
  { id: "trending-anime", kind: "anime", title: "Trending Anime", href: "/anime" },
  { id: "trending-movies", kind: "movie", title: "Trending Movies", href: "/movies" },
  { id: "trending-kdrama", kind: "kdrama", title: "Trending K-Dramas", href: "/kdrama" },
  { id: "trending-tv", kind: "tv", title: "Trending TV Shows", href: "/tv" },
];

export interface HomeRowsOptions {
  providers: ProviderRegistry;
  driver?: StorageDriver;
  limit?: number;
}

export async function getHomeRows(options: HomeRowsOptions): Promise<DiscoverRow[]> {
  const { providers, driver, limit = 20 } = options;

  const [continueWatching, trendingRows, recentLocal] = await Promise.all([
    // Continue Watching needs stored progress, so it is skipped without a driver.
    driver
      ? getContinueWatching(driver, limit)
          .then(toContinueWatchingRow)
          .catch(() => null)
      : Promise.resolve(null),

    Promise.all(
      TRENDING_ROWS.map(async (spec): Promise<DiscoverRow> => {
        const results = await trendingAcrossProviders(providers, spec.kind);

        // Several providers may serve one kind; merge them into a single row.
        const items = results.flatMap((result) => result.items).slice(0, limit);

        return { id: spec.id, title: spec.title, subtitle: null, items, href: spec.href };
      }),
    ),

    driver
      ? getLocalFiles(driver)
          .then((files) => recentlyAddedLocal(files, limit))
          .catch((): MediaItem[] => [])
      : Promise.resolve<MediaItem[]>([]),
  ]);

  const rows: DiscoverRow[] = [
    ...(continueWatching ? [continueWatching] : []),
    ...trendingRows,
    {
      id: "recently-added-local",
      title: "Recently Added",
      subtitle: null,
      items: recentLocal,
      href: "/local",
    },
  ];

  return rows.filter((row) => row.items.length > 0);
}

/**
 * Trending for one kind, merged across every provider that serves it.
 * Backs the category pages.
 */
export async function getTrendingByKind(
  providers: ProviderRegistry,
  kind: MediaKind,
  limit = 30,
): Promise<{ items: MediaItem[]; errors: string[] }> {
  const results = await trendingAcrossProviders(providers, kind);

  return {
    items: results.flatMap((result) => result.items).slice(0, limit),
    errors: results.flatMap((result) => (result.error ? [result.error] : [])),
  };
}
