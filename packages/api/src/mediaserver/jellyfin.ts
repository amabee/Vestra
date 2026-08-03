import { getServerEnv, isMediaServerConfigured } from "@vestra/config";
import type { MediaItem, MediaServerStatus, PlaybackSource } from "@vestra/types";

import { ProviderError, ProviderNotConfiguredError } from "../errors";
import { buildUrl, requestJson } from "../http";

/**
 * Jellyfin client for the user's own server.
 *
 * Server-only. The API key is kept out of the browser; stream URLs are minted
 * server-side and handed to the player as short-lived locators.
 */

interface JellyfinConnection {
  baseUrl: string;
  apiKey: string;
  userId: string | null;
}

function getConnection(): JellyfinConnection {
  if (!isMediaServerConfigured()) {
    throw new ProviderNotConfiguredError(
      "mediaserver",
      "Set MEDIA_SERVER_KIND, MEDIA_SERVER_URL and MEDIA_SERVER_API_KEY.",
    );
  }

  const env = getServerEnv();

  if (env.MEDIA_SERVER_KIND !== "jellyfin") {
    throw new ProviderError(
      "mediaserver",
      `Media server kind "${env.MEDIA_SERVER_KIND}" is not supported yet. Only Jellyfin is implemented.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(env.MEDIA_SERVER_URL as string);
  } catch {
    throw new ProviderError("mediaserver", "MEDIA_SERVER_URL is not a valid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ProviderError("mediaserver", "MEDIA_SERVER_URL must use http or https.");
  }

  if (!env.MEDIA_SERVER_API_KEY) {
    throw new ProviderNotConfiguredError("mediaserver", "MEDIA_SERVER_API_KEY is required.");
  }

  return {
    baseUrl: parsed.origin + parsed.pathname.replace(/\/$/, ""),
    apiKey: env.MEDIA_SERVER_API_KEY,
    userId: null,
  };
}

/** Jellyfin authenticates via a header, keeping the key out of URLs and logs. */
function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `MediaBrowser Token="${apiKey}"` };
}

interface JellyfinItem {
  Id: string;
  Name: string;
  OriginalTitle?: string | null;
  Overview?: string | null;
  ProductionYear?: number | null;
  Type?: string;
  RunTimeTicks?: number | null;
  CommunityRating?: number | null;
  Genres?: string[] | null;
  ImageTags?: Record<string, string> | null;
  BackdropImageTags?: string[] | null;
}

interface JellyfinItemsResponse {
  Items?: JellyfinItem[];
  TotalRecordCount?: number;
}

interface JellyfinSystemInfo {
  ServerName?: string;
  Version?: string;
}

function imageUrl(baseUrl: string, itemId: string, type: "Primary" | "Backdrop"): string {
  return `${baseUrl}/Items/${encodeURIComponent(itemId)}/Images/${type}`;
}

/** Jellyfin measures runtime in 100-nanosecond ticks. */
function ticksToSeconds(ticks: number | null | undefined): number | null {
  if (!ticks || ticks <= 0) return null;
  return Math.round(ticks / 10_000_000);
}

function normaliseItem(item: JellyfinItem, baseUrl: string): MediaItem {
  const isSeries = item.Type === "Series";

  return {
    source: "mediaserver",
    kind: isSeries ? "tv" : "movie",
    sourceId: item.Id,
    title: item.Name,
    originalTitle: item.OriginalTitle ?? null,
    year: item.ProductionYear ?? null,
    overview: item.Overview ?? null,
    images: {
      poster: item.ImageTags?.Primary ? imageUrl(baseUrl, item.Id, "Primary") : null,
      backdrop: item.BackdropImageTags?.length
        ? imageUrl(baseUrl, item.Id, "Backdrop")
        : null,
      thumbnail: item.ImageTags?.Primary ? imageUrl(baseUrl, item.Id, "Primary") : null,
      placeholder: null,
    },
    rating: {
      // Jellyfin community rating is 0–10; Vestra normalises to 0–100.
      score: item.CommunityRating ? Math.round(item.CommunityRating * 10) : null,
      votes: null,
    },
    genres: (item.Genres ?? []).map((name) => ({ id: name.toLowerCase(), name })),
    status: "released",
    durationSeconds: ticksToSeconds(item.RunTimeTicks),
    isSeries,
    sourceUrl: null,
  };
}

export async function getMediaServerStatus(): Promise<MediaServerStatus> {
  try {
    const connection = getConnection();
    const info = await requestJson<JellyfinSystemInfo>(
      "mediaserver",
      buildUrl(connection.baseUrl, "System/Info"),
      { headers: authHeaders(connection.apiKey), revalidate: 0 },
    );

    return {
      connected: true,
      serverName: info.ServerName ?? null,
      version: info.Version ?? null,
      error: null,
    };
  } catch (error) {
    return {
      connected: false,
      serverName: null,
      version: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function searchMediaServer(query: string, limit = 20): Promise<MediaItem[]> {
  const connection = getConnection();

  const data = await requestJson<JellyfinItemsResponse>(
    "mediaserver",
    buildUrl(connection.baseUrl, "Items", {
      searchTerm: query,
      IncludeItemTypes: "Movie,Series",
      Recursive: "true",
      Limit: limit,
      Fields: "Overview,Genres,ProductionYear,OriginalTitle",
    }),
    { headers: authHeaders(connection.apiKey), revalidate: 0 },
  );

  return (data.Items ?? []).map((item) => normaliseItem(item, connection.baseUrl));
}

export async function getRecentlyAdded(limit = 20): Promise<MediaItem[]> {
  const connection = getConnection();

  const data = await requestJson<JellyfinItemsResponse>(
    "mediaserver",
    buildUrl(connection.baseUrl, "Items", {
      IncludeItemTypes: "Movie,Series",
      Recursive: "true",
      SortBy: "DateCreated",
      SortOrder: "Descending",
      Limit: limit,
      Fields: "Overview,Genres,ProductionYear,OriginalTitle",
    }),
    { headers: authHeaders(connection.apiKey), revalidate: 0 },
  );

  return (data.Items ?? []).map((item) => normaliseItem(item, connection.baseUrl));
}

/**
 * Build a direct-play stream locator.
 *
 * The API key is embedded because the browser's `<video>` element cannot send
 * an Authorization header. Only ever return this from a server context to an
 * authenticated user.
 */
export function buildStreamSource(itemId: string): PlaybackSource {
  const connection = getConnection();
  const url = buildUrl(connection.baseUrl, `Videos/${encodeURIComponent(itemId)}/stream`, {
    static: "true",
    api_key: connection.apiKey,
  });

  return {
    kind: "stream",
    locator: url,
    mimeType: "video/mp4",
    label: "Media server (direct play)",
    priority: 50,
  };
}
