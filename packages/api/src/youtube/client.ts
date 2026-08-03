import {
  CACHE_TTL,
  YOUTUBE_API_BASE,
  YOUTUBE_EMBED_BASE,
  getServerEnv,
  isYoutubeConfigured,
} from "@vestra/config";
import type { MediaItem } from "@vestra/types";

import { ProviderNotConfiguredError } from "../errors";
import { buildUrl, requestJson } from "../http";
import { normaliseSearchItem, normaliseVideo } from "./normalize";
import type { YoutubeSearchResponse, YoutubeVideosResponse } from "./types";

/**
 * YouTube Data API v3 client. Server-only — the API key must not reach the browser.
 *
 * Quota note: `search.list` costs 100 units against a 10,000/day default quota,
 * so search results are cached and callers should debounce.
 */

function apiKey(): string {
  if (!isYoutubeConfigured()) {
    throw new ProviderNotConfiguredError(
      "youtube",
      "Set YOUTUBE_API_KEY in your environment.",
    );
  }
  // isYoutubeConfigured() guarantees this is present.
  return getServerEnv().YOUTUBE_API_KEY as string;
}

export interface YoutubeSearchOptions {
  maxResults?: number;
  pageToken?: string;
  /** Restrict to a single channel. */
  channelId?: string;
  order?: "relevance" | "date" | "rating" | "viewCount" | "title";
}

export async function searchYoutube(
  query: string,
  options: YoutubeSearchOptions = {},
): Promise<{ items: MediaItem[]; totalResults: number; nextPageToken: string | null }> {
  const { maxResults = 20, pageToken, channelId, order = "relevance" } = options;

  const url = buildUrl(YOUTUBE_API_BASE, "search", {
    key: apiKey(),
    q: query,
    part: "snippet",
    type: "video",
    maxResults: Math.min(maxResults, 50),
    order,
    // Only embeddable, public videos — anything else can't play inside Vestra.
    videoEmbeddable: "true",
    safeSearch: "moderate",
    pageToken,
    channelId,
  });

  const data = await requestJson<YoutubeSearchResponse>("youtube", url, {
    revalidate: CACHE_TTL.search,
  });

  const items = (data.items ?? [])
    .map(normaliseSearchItem)
    .filter((item): item is MediaItem => item !== null);

  return {
    items,
    totalResults: data.pageInfo?.totalResults ?? items.length,
    nextPageToken: data.nextPageToken ?? null,
  };
}

/**
 * Fetch full details (including duration) for up to 50 video ids in one call.
 * Used to enrich search results, which omit `contentDetails`.
 */
export async function getVideos(ids: readonly string[]): Promise<MediaItem[]> {
  if (ids.length === 0) return [];

  const url = buildUrl(YOUTUBE_API_BASE, "videos", {
    key: apiKey(),
    id: ids.slice(0, 50).join(","),
    part: "snippet,contentDetails,statistics",
  });

  const data = await requestJson<YoutubeVideosResponse>("youtube", url, {
    revalidate: CACHE_TTL.details,
  });

  return (data.items ?? [])
    .map(normaliseVideo)
    .filter((item): item is MediaItem => item !== null);
}

export async function getVideo(id: string): Promise<MediaItem | null> {
  const [video] = await getVideos([id]);
  return video ?? null;
}

/** Search, then enrich with durations in a single extra call. */
export async function searchYoutubeDetailed(
  query: string,
  options: YoutubeSearchOptions = {},
): Promise<{ items: MediaItem[]; totalResults: number; nextPageToken: string | null }> {
  const results = await searchYoutube(query, options);
  if (results.items.length === 0) return results;

  try {
    const detailed = await getVideos(results.items.map((item) => item.sourceId));
    const byId = new Map(detailed.map((item) => [item.sourceId, item]));
    return {
      ...results,
      items: results.items.map((item) => byId.get(item.sourceId) ?? item),
    };
  } catch {
    // Enrichment is best-effort; fall back to the un-enriched search results.
    return results;
  }
}

/**
 * Privacy-preserving embed URL (youtube-nocookie).
 * `videoId` is encoded because it lands directly in an iframe `src`.
 */
export function buildEmbedUrl(
  videoId: string,
  options: { autoplay?: boolean; startSeconds?: number; origin?: string } = {},
): string {
  const { autoplay = false, startSeconds, origin } = options;

  const params = new URLSearchParams({
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
  });

  if (autoplay) params.set("autoplay", "1");
  if (startSeconds && startSeconds > 0) params.set("start", String(Math.floor(startSeconds)));
  if (origin) params.set("origin", origin);

  return `${YOUTUBE_EMBED_BASE}/${encodeURIComponent(videoId)}?${params.toString()}`;
}
