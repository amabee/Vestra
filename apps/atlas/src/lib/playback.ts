import "server-only";

import { mediaserver } from "@vestra/api";
import { isMediaServerConfigured } from "@vestra/config";
import { getLocalFiles } from "@vestra/storage";
import type { MediaItem, PlaybackSource } from "@vestra/types";

import { getDriver } from "./storage";

/**
 * Work out how (and whether) an item can actually be played.
 *
 * Vestra is a metadata aggregator first: TMDb and AniList entries describe
 * content but carry no stream. Those resolve to an `external` source so the UI
 * can offer a deep link instead of a broken player.
 */
export async function resolvePlaybackSources(
  item: Pick<MediaItem, "source" | "kind" | "sourceId" | "sourceUrl">,
): Promise<PlaybackSource[]> {
  const sources: PlaybackSource[] = [];

  switch (item.source) {
    case "youtube":
      sources.push({
        kind: "youtube",
        locator: item.sourceId,
        mimeType: null,
        label: "YouTube",
        priority: 100,
      });
      break;

    case "local": {
      const files = await getLocalFiles(getDriver());
      const file = files.find((entry) => entry.id === item.sourceId);

      if (file) {
        // Streamed through a route handler: the browser can't open file://,
        // and the id lookup keeps arbitrary paths out of the request.
        sources.push({
          kind: "file",
          locator: `/api/stream/local/${encodeURIComponent(file.id)}`,
          mimeType: null,
          label: file.fileName,
          priority: 90,
        });
      }
      break;
    }

    case "mediaserver":
      if (isMediaServerConfigured()) {
        try {
          sources.push(mediaserver.buildStreamSource(item.sourceId));
        } catch {
          // Server unreachable or misconfigured — fall through to external.
        }
      }
      break;

    default:
      break;
  }

  if (item.sourceUrl) {
    sources.push({
      kind: "external",
      locator: item.sourceUrl,
      mimeType: null,
      label: "Open in source",
      priority: 0,
    });
  }

  return sources.sort((a, b) => b.priority - a.priority);
}
