import "server-only";

import { resolvePlayback } from "@vestra/provider-sdk";
import type { MediaItem, PlaybackSource } from "@vestra/types";

import { getAdapterRegistry } from "./registry";

/**
 * Work out how (and whether) an item can actually be played.
 *
 * Delegates to the source-adapter registry. Vestra is a metadata aggregator
 * first: TMDb and AniList entries describe content but carry no stream, so the
 * external adapter supplies a deep link rather than leaving a dead player.
 */
export async function resolvePlaybackSources(item: MediaItem): Promise<PlaybackSource[]> {
  return resolvePlayback(getAdapterRegistry(), item);
}
