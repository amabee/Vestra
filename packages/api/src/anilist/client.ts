import { ANILIST_GRAPHQL_ENDPOINT, CACHE_TTL } from "@vestra/config/constants";
import type { MediaDetails, MediaItem } from "@vestra/types";

import { ProviderError } from "../errors";
import { requestJson } from "../http";
import { normaliseAnime, normaliseAnimeDetails } from "./normalize";
import {
  ANIME_DETAILS_QUERY,
  POPULAR_ANIME_QUERY,
  SEARCH_ANIME_QUERY,
  TRENDING_ANIME_QUERY,
} from "./queries";
import type {
  AnilistGraphQLResponse,
  AnilistMediaResponse,
  AnilistPageResponse,
} from "./types";

/**
 * AniList client.
 *
 * Public queries need no credentials, so this provider works out of the box.
 * AniList rate-limits to ~90 requests/minute per IP.
 */

async function anilistQuery<T>(
  query: string,
  variables: Record<string, unknown> = {},
  revalidate: number = CACHE_TTL.trending,
): Promise<T> {
  const payload = await requestJson<AnilistGraphQLResponse<T>>(
    "anilist",
    ANILIST_GRAPHQL_ENDPOINT,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      revalidate,
    },
  );

  // GraphQL returns HTTP 200 with an `errors` array, so this must be checked explicitly.
  if (payload.errors && payload.errors.length > 0) {
    const message = payload.errors.map((e) => e.message).join("; ");
    throw new ProviderError("anilist", `AniList query failed: ${message}`, {
      status: payload.errors[0]?.status ?? null,
    });
  }

  if (!payload.data) {
    throw new ProviderError("anilist", "AniList returned an empty response.");
  }

  return payload.data;
}

export interface AnilistSearchOptions {
  page?: number;
  perPage?: number;
  includeAdult?: boolean;
}

export async function searchAnime(
  search: string,
  options: AnilistSearchOptions = {},
): Promise<{ items: MediaItem[]; totalResults: number; hasMore: boolean }> {
  const { page = 1, perPage = 20, includeAdult = false } = options;

  const data = await anilistQuery<AnilistPageResponse>(
    SEARCH_ANIME_QUERY,
    { search, page, perPage, isAdult: includeAdult },
    CACHE_TTL.search,
  );

  const media = data.Page?.media ?? [];

  return {
    items: media.map(normaliseAnime),
    totalResults: data.Page?.pageInfo?.total ?? media.length,
    hasMore: data.Page?.pageInfo?.hasNextPage ?? false,
  };
}

export async function getTrendingAnime(page = 1, perPage = 20): Promise<MediaItem[]> {
  const data = await anilistQuery<AnilistPageResponse>(TRENDING_ANIME_QUERY, { page, perPage });
  return (data.Page?.media ?? []).map(normaliseAnime);
}

export async function getPopularAnime(page = 1, perPage = 20): Promise<MediaItem[]> {
  const data = await anilistQuery<AnilistPageResponse>(POPULAR_ANIME_QUERY, { page, perPage });
  return (data.Page?.media ?? []).map(normaliseAnime);
}

export async function getAnimeDetails(id: string): Promise<MediaDetails> {
  const numericId = Number.parseInt(id, 10);
  if (!Number.isFinite(numericId)) {
    throw new ProviderError("anilist", `Invalid AniList id: ${id}`);
  }

  const data = await anilistQuery<AnilistMediaResponse>(
    ANIME_DETAILS_QUERY,
    { id: numericId },
    CACHE_TTL.details,
  );

  if (!data.Media) {
    throw new ProviderError("anilist", `Anime ${id} was not found.`, { status: 404 });
  }

  return normaliseAnimeDetails(data.Media);
}
