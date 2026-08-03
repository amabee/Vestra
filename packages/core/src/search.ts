import { anilist, mediaserver, toProviderMessage, tmdb, youtube } from "@vestra/api";
import {
  SOURCE_META,
  isMediaServerConfigured,
  isQbittorrentConfigured,
  isTmdbConfigured,
  isYoutubeConfigured,
} from "@vestra/config";
import { getLocalFiles, type StorageDriver } from "@vestra/storage";
import type {
  MediaItem,
  MediaSource,
  SearchQuery,
  SearchResponse,
  SearchResultGroup,
} from "@vestra/types";

import { localFileToMediaItem } from "./local-library";

/**
 * Universal search.
 *
 * Every provider runs concurrently and is isolated: a slow or failing source
 * produces an empty group with an `error` message instead of failing the query.
 */

export interface SearchDependencies {
  /** Required only when "local" is among the searched sources. */
  driver?: StorageDriver;
}

type Searcher = (query: SearchQuery) => Promise<{
  items: MediaItem[];
  totalResults: number;
  hasMore: boolean;
}>;

function buildSearchers(deps: SearchDependencies): Partial<Record<MediaSource, Searcher>> {
  return {
    tmdb: async (query) => {
      const result = await tmdb.searchTmdb(query.query, { page: query.page });
      return {
        items: result.items.slice(0, query.perPage),
        totalResults: result.totalResults,
        hasMore: result.hasMore,
      };
    },

    anilist: async (query) => {
      const result = await anilist.searchAnime(query.query, {
        page: query.page,
        perPage: query.perPage,
      });
      return result;
    },

    youtube: async (query) => {
      const result = await youtube.searchYoutubeDetailed(query.query, {
        maxResults: query.perPage,
      });
      return {
        items: result.items,
        totalResults: result.totalResults,
        hasMore: result.nextPageToken !== null,
      };
    },

    mediaserver: async (query) => {
      const items = await mediaserver.searchMediaServer(query.query, query.perPage);
      return { items, totalResults: items.length, hasMore: false };
    },

    local: async (query) => {
      if (!deps.driver) {
        return { items: [], totalResults: 0, hasMore: false };
      }

      const files = await getLocalFiles(deps.driver);
      const needle = query.query.toLowerCase();

      const matches = files.filter((file) => {
        const haystack = `${file.parsedTitle ?? ""} ${file.fileName}`.toLowerCase();
        return haystack.includes(needle);
      });

      return {
        items: matches.slice(0, query.perPage).map(localFileToMediaItem),
        totalResults: matches.length,
        hasMore: matches.length > query.perPage,
      };
    },
  };
}

/** Sources that are configured and therefore worth querying. */
export function getAvailableSources(): MediaSource[] {
  const available: MediaSource[] = ["anilist", "local"];

  if (isTmdbConfigured()) available.unshift("tmdb");
  if (isYoutubeConfigured()) available.push("youtube");
  if (isMediaServerConfigured()) available.push("mediaserver");
  if (isQbittorrentConfigured()) available.push("qbittorrent");

  return available;
}

export async function universalSearch(
  query: SearchQuery,
  deps: SearchDependencies = {},
): Promise<SearchResponse> {
  const searchers = buildSearchers(deps);

  // qBittorrent is a transfer manager, not a catalogue — never search it.
  const requested = query.sources.length > 0 ? query.sources : getAvailableSources();
  const targets = requested.filter(
    (source): source is MediaSource => source !== "qbittorrent" && source in searchers,
  );

  const groups = await Promise.all(
    targets.map(async (source): Promise<SearchResultGroup> => {
      const started = Date.now();
      const searcher = searchers[source];

      const base = {
        source,
        label: SOURCE_META[source].label,
        elapsedMs: 0,
      };

      if (!searcher) {
        return { ...base, items: [], totalResults: 0, hasMore: false, error: null };
      }

      try {
        const result = await searcher(query);
        return {
          ...base,
          items: result.items,
          totalResults: result.totalResults,
          hasMore: result.hasMore,
          error: null,
          elapsedMs: Date.now() - started,
        };
      } catch (error) {
        // Isolated failure: this group shows an inline message, others still render.
        return {
          ...base,
          items: [],
          totalResults: 0,
          hasMore: false,
          error: toProviderMessage(error),
          elapsedMs: Date.now() - started,
        };
      }
    }),
  );

  // Drop groups that are both empty and healthy, so the UI stays uncluttered.
  const meaningful = groups.filter((group) => group.items.length > 0 || group.error !== null);

  return {
    query: query.query,
    groups: meaningful,
    totalResults: meaningful.reduce((sum, group) => sum + group.items.length, 0),
  };
}

/**
 * Flatten grouped results into a single ranked list for keyboard navigation.
 * Ordering follows the user's configured source order, then provider relevance.
 */
export function flattenSearchResults(response: SearchResponse): MediaItem[] {
  return response.groups.flatMap((group) => group.items);
}
