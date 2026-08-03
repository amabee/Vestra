import type { MetadataProvider } from "@vestra/provider-sdk";
import { getLocalFiles, type StorageDriver } from "@vestra/storage";

import { localFileToMediaItem } from "./local-library";
import { widenToDetails } from "./shared";

/**
 * Local library — video files scanned from disk.
 *
 * Takes the storage driver as a dependency rather than reaching for a global,
 * so Atlas and Nova can point it at different data directories.
 */
export function createLocalProvider(driver: StorageDriver): MetadataProvider {
  return {
    id: "local",
    name: "Local Library",
    kinds: ["local-video"],
    capabilities: { search: true, details: true, trending: false },
    // Meaningless on a host that cannot read the disk.
    requires: { filesystem: true },

    // Always available: an empty library is a valid state, not a failure.
    isAvailable: () => true,

    async search(query) {
      const files = await getLocalFiles(driver);
      const needle = query.query.toLowerCase();

      const matches = files.filter((file) =>
        `${file.parsedTitle ?? ""} ${file.fileName}`.toLowerCase().includes(needle),
      );

      return {
        items: matches.slice(0, query.perPage).map(localFileToMediaItem),
        totalResults: matches.length,
        hasMore: matches.length > query.perPage,
      };
    },

    async getDetails(ref) {
      const files = await getLocalFiles(driver);
      const file = files.find((entry) => entry.id === ref.sourceId);
      return file ? widenToDetails(localFileToMediaItem(file)) : null;
    },
  };
}
