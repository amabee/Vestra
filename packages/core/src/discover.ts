import { anilist, tmdb } from "@vestra/api";
import { isTmdbConfigured } from "@vestra/config";
import { getLocalFiles, type StorageDriver } from "@vestra/storage";
import type { DiscoverRow, MediaItem } from "@vestra/types";

import { getContinueWatching, toContinueWatchingRow } from "./continue-watching";
import { recentlyAddedLocal } from "./local-library";

/**
 * Home page composition.
 *
 * Rows are fetched concurrently and independently: a provider that fails yields
 * an empty row, which is then dropped, rather than breaking the page.
 */

async function safeRow(
  id: DiscoverRow["id"],
  title: string,
  href: string | null,
  loader: () => Promise<MediaItem[]>,
): Promise<DiscoverRow> {
  try {
    const items = await loader();
    return { id, title, subtitle: null, items, href };
  } catch {
    return { id, title, subtitle: null, items: [], href };
  }
}

export interface HomeRowsOptions {
  driver?: StorageDriver;
  limit?: number;
}

export async function getHomeRows(options: HomeRowsOptions = {}): Promise<DiscoverRow[]> {
  const { driver, limit = 20 } = options;
  const tmdbReady = isTmdbConfigured();

  const [continueWatching, trendingAnime, trendingMovies, trendingKdrama, trendingTv, recentLocal] =
    await Promise.all([
      driver
        ? getContinueWatching(driver, limit).then(toContinueWatchingRow)
        : Promise.resolve<DiscoverRow>({
            id: "continue-watching",
            title: "Continue Watching",
            subtitle: null,
            items: [],
            href: null,
          }),

      safeRow("trending-anime", "Trending Anime", "/anime", () =>
        anilist.getTrendingAnime(1, limit),
      ),

      safeRow("trending-movies", "Trending Movies", "/movies", () =>
        tmdbReady ? tmdb.getTrendingMovies("week") : Promise.resolve([]),
      ),

      safeRow("trending-kdrama", "Trending K-Dramas", "/kdrama", () =>
        tmdbReady ? tmdb.getTrendingKdramas() : Promise.resolve([]),
      ),

      safeRow("trending-tv", "Trending TV Shows", "/tv", () =>
        tmdbReady ? tmdb.getTrendingTv("week") : Promise.resolve([]),
      ),

      safeRow("recently-added-local", "Recently Added", "/local", async () => {
        if (!driver) return [];
        const files = await getLocalFiles(driver);
        return recentlyAddedLocal(files, limit);
      }),
    ]);

  const rows: DiscoverRow[] = [
    continueWatching,
    trendingAnime,
    trendingMovies,
    trendingKdrama,
    trendingTv,
    recentLocal,
  ];

  return rows.filter((row) => row.items.length > 0);
}

/**
 * "Recommended For You" — derived from the genres of watchlisted anime.
 * A local heuristic for now; a real recommender can slot in behind this signature.
 */
export async function getRecommendations(limit = 20): Promise<DiscoverRow> {
  return safeRow("recommended", "Recommended For You", null, () =>
    anilist.getPopularAnime(1, limit),
  );
}
