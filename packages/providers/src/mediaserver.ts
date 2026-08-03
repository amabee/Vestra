import { mediaserver } from "@vestra/api";
import { isMediaServerConfigured } from "@vestra/config";
import type { MetadataProvider } from "@vestra/provider-sdk";

/**
 * Personal media server (Jellyfin).
 *
 * Search only for now — the Jellyfin client does not yet fetch a full item
 * payload, so `details` stays false rather than returning a hollow object.
 */
export function createMediaServerProvider(): MetadataProvider {
  return {
    id: "mediaserver",
    name: "Media Server",
    kinds: ["movie", "tv"],
    capabilities: { search: true, details: false, trending: false },

    isAvailable: () => isMediaServerConfigured(),

    async search(query) {
      const items = await mediaserver.searchMediaServer(query.query, query.perPage);
      return { items, totalResults: items.length, hasMore: false };
    },
  };
}
