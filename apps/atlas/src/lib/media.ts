import "server-only";

import { anilist, tmdb, youtube } from "@vestra/api";
import { getLocalFiles } from "@vestra/storage";
import { localFileToMediaItem } from "@vestra/core/local-library";
import type { MediaDetails, MediaKind, MediaSource } from "@vestra/types";

import { getDriver } from "./storage";

/** Widen a MediaItem into MediaDetails for providers with no richer payload. */
function toDetails(item: Awaited<ReturnType<typeof youtube.getVideo>>): MediaDetails | null {
  if (!item) return null;

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
    external: {},
  };
}

/**
 * Resolve full details for any `source`/`kind`/`id` triple.
 * Returns null when the item does not exist, so pages can call `notFound()`.
 */
export async function getMediaDetails(
  source: MediaSource,
  kind: MediaKind,
  id: string,
): Promise<MediaDetails | null> {
  switch (source) {
    case "tmdb":
      // K-drama is a Vestra-derived kind; TMDb serves it from the /tv endpoint.
      return kind === "movie" ? tmdb.getMovieDetails(id) : tmdb.getTvDetails(id);

    case "anilist":
      return anilist.getAnimeDetails(id);

    case "youtube":
      return toDetails(await youtube.getVideo(id));

    case "local": {
      const files = await getLocalFiles(getDriver());
      const file = files.find((entry) => entry.id === id);
      return file ? toDetails(localFileToMediaItem(file)) : null;
    }

    default:
      return null;
  }
}
