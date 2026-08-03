import type { MediaDetails, MediaItem } from "@vestra/types";

/**
 * Widen a MediaItem into MediaDetails.
 *
 * Used by providers whose API returns no richer payload than the list item
 * (YouTube, local files), so callers get a consistent shape either way.
 */
export function widenToDetails(item: MediaItem): MediaDetails {
  return {
    ...item,
    tagline: null,
    certification: null,
    cast: [],
    seasons: [],
    related: [],
    studios: [],
    countries: [],
    languages: [],
    streaming: [],
    external: {},
  };
}
