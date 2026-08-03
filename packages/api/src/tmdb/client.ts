import {
  CACHE_TTL,
  KDRAMA_DISCOVER_PARAMS,
  TMDB_API_BASE,
  getServerEnv,
  isTmdbConfigured,
} from "@vestra/config";
import type { MediaDetails, MediaItem } from "@vestra/types";

import { ProviderNotConfiguredError } from "../errors";
import { buildUrl, requestJson, type RequestOptions } from "../http";
import {
  normaliseMovie,
  normaliseMovieDetails,
  normaliseSeason,
  normaliseTv,
  normaliseTvDetails,
} from "./normalize";
import type { TmdbMovie, TmdbMultiResult, TmdbPaged, TmdbSeason, TmdbTv } from "./types";

/**
 * TMDb client. Server-only — credentials must never reach the browser.
 *
 * Prefers the v4 bearer token; falls back to the v3 `api_key` query parameter.
 */

function assertConfigured(): void {
  if (!isTmdbConfigured()) {
    throw new ProviderNotConfiguredError(
      "tmdb",
      "Set TMDB_ACCESS_TOKEN (v4) or TMDB_API_KEY (v3) in your environment.",
    );
  }
}

function authFor(query: Record<string, string | number | undefined>) {
  const env = getServerEnv();

  if (env.TMDB_ACCESS_TOKEN) {
    return {
      headers: { Authorization: `Bearer ${env.TMDB_ACCESS_TOKEN}` },
      query,
    };
  }

  return {
    headers: {} as Record<string, string>,
    query: { ...query, api_key: env.TMDB_API_KEY },
  };
}

async function tmdbGet<T>(
  path: string,
  query: Record<string, string | number | undefined> = {},
  options: Pick<RequestOptions, "revalidate" | "signal"> = {},
): Promise<T> {
  assertConfigured();

  const { headers, query: authedQuery } = authFor({ language: "en-US", ...query });
  const url = buildUrl(TMDB_API_BASE, path, authedQuery);

  return requestJson<T>("tmdb", url, {
    headers,
    revalidate: options.revalidate ?? CACHE_TTL.trending,
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

/* -----------------------------------------------------------------------------
 * Search
 * -------------------------------------------------------------------------- */

export interface TmdbSearchOptions {
  page?: number;
  includeAdult?: boolean;
  signal?: AbortSignal;
}

/** Multi-search across movies and TV; people are filtered out. */
export async function searchTmdb(
  query: string,
  options: TmdbSearchOptions = {},
): Promise<{ items: MediaItem[]; totalResults: number; hasMore: boolean }> {
  const { page = 1, includeAdult = false, signal } = options;

  const data = await tmdbGet<TmdbPaged<TmdbMultiResult>>(
    "search/multi",
    { query, page, include_adult: String(includeAdult) },
    { revalidate: CACHE_TTL.search, ...(signal ? { signal } : {}) },
  );

  const items = data.results.reduce<MediaItem[]>((acc, result) => {
    if (result.media_type === "movie") acc.push(normaliseMovie(result));
    else if (result.media_type === "tv") acc.push(normaliseTv(result));
    return acc;
  }, []);

  return {
    items,
    totalResults: data.total_results,
    hasMore: data.page < data.total_pages,
  };
}

export async function searchMovies(
  query: string,
  options: TmdbSearchOptions = {},
): Promise<MediaItem[]> {
  const { page = 1, includeAdult = false, signal } = options;
  const data = await tmdbGet<TmdbPaged<TmdbMovie>>(
    "search/movie",
    { query, page, include_adult: String(includeAdult) },
    { revalidate: CACHE_TTL.search, ...(signal ? { signal } : {}) },
  );
  return data.results.map(normaliseMovie);
}

export async function searchTv(
  query: string,
  options: TmdbSearchOptions = {},
): Promise<MediaItem[]> {
  const { page = 1, includeAdult = false, signal } = options;
  const data = await tmdbGet<TmdbPaged<TmdbTv>>(
    "search/tv",
    { query, page, include_adult: String(includeAdult) },
    { revalidate: CACHE_TTL.search, ...(signal ? { signal } : {}) },
  );
  return data.results.map(normaliseTv);
}

/* -----------------------------------------------------------------------------
 * Trending & discovery
 * -------------------------------------------------------------------------- */

export type TrendingWindow = "day" | "week";

export async function getTrendingMovies(
  window: TrendingWindow = "week",
  page = 1,
): Promise<MediaItem[]> {
  const data = await tmdbGet<TmdbPaged<TmdbMovie>>(`trending/movie/${window}`, { page });
  return data.results.map(normaliseMovie);
}

export async function getTrendingTv(
  window: TrendingWindow = "week",
  page = 1,
): Promise<MediaItem[]> {
  const data = await tmdbGet<TmdbPaged<TmdbTv>>(`trending/tv/${window}`, { page });
  return data.results.map(normaliseTv);
}

/** K-dramas: Korean-origin TV, sorted by popularity. */
export async function getTrendingKdramas(page = 1): Promise<MediaItem[]> {
  const data = await tmdbGet<TmdbPaged<TmdbTv>>("discover/tv", {
    ...KDRAMA_DISCOVER_PARAMS,
    page,
  });
  // Force the K-drama kind — /discover/tv omits origin_country on some entries.
  return data.results.map((show) => ({ ...normaliseTv(show), kind: "kdrama" as const }));
}

export async function getPopularMovies(page = 1): Promise<MediaItem[]> {
  const data = await tmdbGet<TmdbPaged<TmdbMovie>>("movie/popular", { page });
  return data.results.map(normaliseMovie);
}

export async function getPopularTv(page = 1): Promise<MediaItem[]> {
  const data = await tmdbGet<TmdbPaged<TmdbTv>>("tv/popular", { page });
  return data.results.map(normaliseTv);
}

/* -----------------------------------------------------------------------------
 * Details
 * -------------------------------------------------------------------------- */

export async function getMovieDetails(id: string): Promise<MediaDetails> {
  const movie = await tmdbGet<TmdbMovie>(
    `movie/${id}`,
    { append_to_response: "credits,similar,release_dates" },
    { revalidate: CACHE_TTL.details },
  );
  return normaliseMovieDetails(movie);
}

export async function getTvDetails(id: string): Promise<MediaDetails> {
  const show = await tmdbGet<TmdbTv>(
    `tv/${id}`,
    { append_to_response: "credits,similar,content_ratings" },
    { revalidate: CACHE_TTL.details },
  );
  return normaliseTvDetails(show);
}

/** Episodes are fetched per-season; TMDb does not return them on the show payload. */
export async function getSeason(showId: string, seasonNumber: number) {
  const season = await tmdbGet<TmdbSeason>(
    `tv/${showId}/season/${seasonNumber}`,
    {},
    { revalidate: CACHE_TTL.details },
  );
  return normaliseSeason(season);
}
