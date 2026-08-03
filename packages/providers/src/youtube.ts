import { youtube } from "@vestra/api";
import { isYoutubeConfigured } from "@vestra/config";
import type { MetadataProvider } from "@vestra/provider-sdk";

import { widenToDetails } from "./shared";

/**
 * YouTube — videos.
 *
 * No trending: the Data API charges 100 quota units per search against a
 * 10,000/day default, so unattended trending rows would exhaust it quickly.
 */
export function createYoutubeProvider(): MetadataProvider {
  return {
    id: "youtube",
    name: "YouTube",
    kinds: ["youtube-video"],
    capabilities: { search: true, details: true, trending: false },

    isAvailable: () => isYoutubeConfigured(),

    async search(query) {
      const result = await youtube.searchYoutubeDetailed(query.query, {
        maxResults: query.perPage,
      });

      return {
        items: result.items,
        totalResults: result.totalResults,
        hasMore: result.nextPageToken !== null,
      };
    },

    async getDetails(ref) {
      const video = await youtube.getVideo(ref.sourceId);
      return video ? widenToDetails(video) : null;
    },
  };
}
