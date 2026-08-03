import { YOUTUBE_WATCH_BASE } from "@vestra/config/constants";
import type { MediaItem } from "@vestra/types";

import type {
  YoutubeSearchItem,
  YoutubeThumbnails,
  YoutubeVideoItem,
} from "./types";

/**
 * Parse an ISO 8601 duration (e.g. `PT1H2M10S`) into seconds.
 * YouTube only ever emits hours/minutes/seconds for videos.
 */
export function parseIsoDuration(duration: string | undefined): number | null {
  if (!duration) return null;

  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(duration);
  if (!match) return null;

  const [, days, hours, minutes, seconds] = match;
  const total =
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0);

  return total > 0 ? total : null;
}

function bestThumbnail(thumbnails: YoutubeThumbnails | undefined): string | null {
  if (!thumbnails) return null;
  return (
    thumbnails.maxres?.url ??
    thumbnails.standard?.url ??
    thumbnails.high?.url ??
    thumbnails.medium?.url ??
    thumbnails.default?.url ??
    null
  );
}

function smallThumbnail(thumbnails: YoutubeThumbnails | undefined): string | null {
  if (!thumbnails) return null;
  return thumbnails.medium?.url ?? thumbnails.default?.url ?? bestThumbnail(thumbnails);
}

function yearFrom(publishedAt: string | undefined): number | null {
  if (!publishedAt) return null;
  const year = Number.parseInt(publishedAt.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

function watchUrl(videoId: string): string {
  return `${YOUTUBE_WATCH_BASE}?v=${encodeURIComponent(videoId)}`;
}

export function normaliseSearchItem(item: YoutubeSearchItem): MediaItem | null {
  const videoId = item.id.videoId;
  if (!videoId) return null;

  const thumb = bestThumbnail(item.snippet.thumbnails);

  return {
    source: "youtube",
    kind: "youtube-video",
    sourceId: videoId,
    title: item.snippet.title,
    originalTitle: null,
    year: yearFrom(item.snippet.publishedAt),
    overview: item.snippet.description || null,
    images: {
      // YouTube thumbnails are 16:9, so the same asset serves as poster and backdrop.
      poster: thumb,
      backdrop: thumb,
      thumbnail: smallThumbnail(item.snippet.thumbnails),
      placeholder: null,
    },
    rating: { score: null, votes: null },
    genres: [{ id: "youtube", name: item.snippet.channelTitle }],
    status: "released",
    // `search.list` omits duration; enrich via `videos.list` when it matters.
    durationSeconds: null,
    isSeries: false,
    sourceUrl: watchUrl(videoId),
  };
}

export function normaliseVideo(item: YoutubeVideoItem): MediaItem | null {
  const snippet = item.snippet;
  if (!snippet) return null;

  const thumb = bestThumbnail(snippet.thumbnails);
  const views = item.statistics?.viewCount
    ? Number.parseInt(item.statistics.viewCount, 10)
    : null;

  return {
    source: "youtube",
    kind: "youtube-video",
    sourceId: item.id,
    title: snippet.title,
    originalTitle: null,
    year: yearFrom(snippet.publishedAt),
    overview: snippet.description || null,
    images: {
      poster: thumb,
      backdrop: thumb,
      thumbnail: smallThumbnail(snippet.thumbnails),
      placeholder: null,
    },
    rating: {
      score: null,
      votes: Number.isFinite(views) ? views : null,
    },
    genres: [{ id: "youtube", name: snippet.channelTitle }],
    status: "released",
    durationSeconds: parseIsoDuration(item.contentDetails?.duration),
    isSeries: false,
    sourceUrl: watchUrl(item.id),
  };
}

/** Channel name is stashed in `genres[0]`; this reads it back for display. */
export function channelNameOf(item: MediaItem): string | null {
  if (item.source !== "youtube") return null;
  return item.genres[0]?.name ?? null;
}
