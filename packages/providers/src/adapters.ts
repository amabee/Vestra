import { mediaserver } from "@vestra/api";
import { isMediaServerConfigured } from "@vestra/config";
import type { SourceAdapter } from "@vestra/provider-sdk";
import { getLocalFiles, type StorageDriver } from "@vestra/storage";
import type { MediaDetails, MediaItem } from "@vestra/types";

/**
 * Source adapters — how an item actually plays.
 *
 * Kept separate from metadata providers on purpose. Vestra can hold rich
 * metadata for a film it has no legal right to stream, and still offer a
 * working action: the external adapter deep-links to the official source.
 * Nothing here scrapes a streaming service.
 */

/** Embedded YouTube playback. */
export function createYoutubeAdapter(): SourceAdapter {
  return {
    id: "youtube-embed",
    name: "YouTube",
    isAvailable: () => true,
    canHandle: (item) => item.kind === "youtube-video",

    async resolve(item) {
      return [
        {
          kind: "youtube",
          locator: item.sourceId,
          mimeType: null,
          label: "YouTube",
          priority: 100,
        },
      ];
    },
  };
}

export interface LocalFileAdapterOptions {
  /**
   * Builds the URL the player will load for a given file id.
   *
   * Injected because the host decides how bytes are served: Atlas proxies
   * through a range-capable route handler, while Nova can read the file
   * directly. The adapter must not assume either.
   */
  buildStreamUrl: (fileId: string) => string;
}

/** Local files from the scanned library. */
export function createLocalFileAdapter(
  driver: StorageDriver,
  options: LocalFileAdapterOptions,
): SourceAdapter {
  return {
    id: "local-file",
    name: "Local File",
    requires: { filesystem: true },
    isAvailable: () => true,
    canHandle: (item) => item.source === "local",

    async resolve(item) {
      // Confirm the file is still indexed before handing back a locator.
      const files = await getLocalFiles(driver);
      const file = files.find((entry) => entry.id === item.sourceId);
      if (!file) return [];

      return [
        {
          kind: "file",
          locator: options.buildStreamUrl(file.id),
          mimeType: null,
          label: file.fileName,
          priority: 90,
        },
      ];
    },
  };
}

/**
 * Plays a catalogue entry from a file the user owns.
 *
 * This is the bridge that makes metadata providers playable: AniList and TMDb
 * carry no video, but once the scanner has matched a local file to their entry,
 * "Play" on that entry resolves to the user's own copy.
 *
 * For a series every matched episode is returned, ordered so episode 1 leads.
 */
export function createMatchedLocalAdapter(
  driver: StorageDriver,
  options: LocalFileAdapterOptions,
): SourceAdapter {
  return {
    id: "matched-local",
    name: "Your Library",
    requires: { filesystem: true },
    isAvailable: () => true,
    // Catalogue entries only; genuine local items are handled by local-file.
    canHandle: (item) => item.source !== "local" && item.source !== "youtube",

    async resolve(item) {
      const files = await getLocalFiles(driver);

      const matches = files
        .filter(
          (file) =>
            file.matchedRef !== null &&
            file.matchedRef.source === item.source &&
            file.matchedRef.kind === item.kind &&
            file.matchedRef.sourceId === item.sourceId,
        )
        .sort(
          (a, b) =>
            (a.parsedSeason ?? 0) - (b.parsedSeason ?? 0) ||
            (a.parsedEpisode ?? 0) - (b.parsedEpisode ?? 0),
        );

      return matches.map((file, index) => {
        const episodeLabel =
          file.parsedEpisode !== null
            ? `S${String(file.parsedSeason ?? 1).padStart(2, "0")}E${String(file.parsedEpisode).padStart(2, "0")}`
            : null;

        return {
          kind: "file" as const,
          locator: options.buildStreamUrl(file.id),
          mimeType: null,
          label: episodeLabel ? `${episodeLabel} · ${file.fileName}` : file.fileName,
          // Outrank the external deep link, and keep playlist order stable.
          priority: 95 - index,
        };
      });
    },
  };
}

/** Direct play from the user's own Jellyfin server. */
export function createMediaServerAdapter(): SourceAdapter {
  return {
    id: "mediaserver-stream",
    name: "Media Server",
    isAvailable: () => isMediaServerConfigured(),
    canHandle: (item) => item.source === "mediaserver",

    async resolve(item) {
      try {
        return [mediaserver.buildStreamSource(item.sourceId)];
      } catch {
        // Server unreachable or misconfigured; other adapters still apply.
        return [];
      }
    },
  };
}

/**
 * Official streaming services carrying the title.
 *
 * Surfaces the licensed links Vestra already receives — AniList's per-episode
 * `streamingEpisodes` (Crunchyroll, HIDIVE, Netflix, Muse Asia) and TMDb's
 * JustWatch-backed availability. These are deep links out to services the user
 * subscribes to; Vestra never proxies, re-hosts or scrapes the video.
 *
 * Ranked above the bare provider link but below anything Vestra can play
 * directly, so an owned file always wins over sending the user to a browser.
 */
export function createOfficialStreamingAdapter(options: {
  /** Fetches the details payload carrying `streaming`. */
  resolveDetails: (item: MediaItem) => Promise<MediaDetails | null>;
}): SourceAdapter {
  return {
    id: "official-streaming",
    name: "Official Streaming",
    isAvailable: () => true,
    // Only metadata sources carry availability; owned content never needs it.
    canHandle: (item) => item.source === "anilist" || item.source === "tmdb",

    async resolve(item) {
      const details = await options.resolveDetails(item).catch(() => null);
      if (!details) return [];

      return details.streaming.map((link, index) => ({
        kind: "external" as const,
        locator: link.url,
        mimeType: null,
        label: link.episodeTitle
          ? `${link.service} — ${link.episodeTitle}`
          : `Watch on ${link.service}`,
        // Preserve the provider's ordering; all sit between local and the
        // generic source link.
        priority: 50 - index,
      }));
    },
  };
}

/**
 * Deep link to the provider's own page.
 *
 * Lowest priority, so it only wins when nothing can actually play in-app.
 * This is what keeps metadata-only sources useful instead of dead ends.
 */
export function createExternalAdapter(): SourceAdapter {
  return {
    id: "external-link",
    name: "Open in Source",
    isAvailable: () => true,
    canHandle: (item) => item.sourceUrl !== null,

    async resolve(item) {
      if (!item.sourceUrl) return [];

      return [
        {
          kind: "external",
          locator: item.sourceUrl,
          mimeType: null,
          label: "Open in source",
          priority: 0,
        },
      ];
    },
  };
}
