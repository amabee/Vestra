import { z } from "zod";

/* =============================================================================
 * Sources
 * ========================================================================== */

/** Every provider Vestra can pull content from. */
export const MEDIA_SOURCES = [
  "anilist",
  "tmdb",
  "youtube",
  "local",
  "mediaserver",
  "qbittorrent",
] as const;

export const mediaSourceSchema = z.enum(MEDIA_SOURCES);
export type MediaSource = z.infer<typeof mediaSourceSchema>;

/** Content classification, used for routing and section grouping. */
export const MEDIA_KINDS = [
  "anime",
  "movie",
  "tv",
  "kdrama",
  "youtube-video",
  "local-video",
] as const;

export const mediaKindSchema = z.enum(MEDIA_KINDS);
export type MediaKind = z.infer<typeof mediaKindSchema>;

/**
 * Stable, globally unique pointer to a piece of media.
 * Serialised as `source:kind:sourceId` (see `mediaKey()` in @vestra/core).
 */
export const mediaRefSchema = z.object({
  source: mediaSourceSchema,
  kind: mediaKindSchema,
  sourceId: z.string().min(1),
});
export type MediaRef = z.infer<typeof mediaRefSchema>;

/** Serialise a ref to its canonical `source:kind:sourceId` string form. */
export function mediaKey(ref: MediaRef): string {
  return `${ref.source}:${ref.kind}:${ref.sourceId}`;
}

/** Inverse of `mediaKey`. Returns null when the key is malformed or unknown. */
export function parseMediaKey(key: string): MediaRef | null {
  const parts = key.split(":");
  if (parts.length < 3) return null;

  const [source, kind, ...rest] = parts;
  // sourceId may legitimately contain ":" (some provider ids do), so rejoin it.
  const sourceId = rest.join(":");

  const parsed = mediaRefSchema.safeParse({ source, kind, sourceId });
  return parsed.success ? parsed.data : null;
}

/** True when both refs point at the same item. */
export function isSameMedia(a: MediaRef, b: MediaRef): boolean {
  return a.source === b.source && a.kind === b.kind && a.sourceId === b.sourceId;
}

/* =============================================================================
 * Supporting shapes
 * ========================================================================== */

export const imageSetSchema = z.object({
  poster: z.string().url().nullable().default(null),
  backdrop: z.string().url().nullable().default(null),
  thumbnail: z.string().url().nullable().default(null),
  /** Tiny blurred placeholder (data URI or colour hex) for smooth loading. */
  placeholder: z.string().nullable().default(null),
});
export type ImageSet = z.infer<typeof imageSetSchema>;

export const genreSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type Genre = z.infer<typeof genreSchema>;

export const castMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().nullable().default(null),
  image: z.string().url().nullable().default(null),
});
export type CastMember = z.infer<typeof castMemberSchema>;

/** Normalised 0–100 rating so AniList (0–100) and TMDb (0–10) are comparable. */
export const ratingSchema = z.object({
  score: z.number().min(0).max(100).nullable().default(null),
  votes: z.number().int().nonnegative().nullable().default(null),
});
export type Rating = z.infer<typeof ratingSchema>;

export const releaseStatusSchema = z.enum([
  "released",
  "airing",
  "upcoming",
  "cancelled",
  "unknown",
]);
export type ReleaseStatus = z.infer<typeof releaseStatusSchema>;

/* =============================================================================
 * The normalised media item — every provider maps into this shape.
 * ========================================================================== */

export const mediaItemSchema = mediaRefSchema.extend({
  title: z.string(),
  /** Original-language or alternate title, when it differs from `title`. */
  originalTitle: z.string().nullable().default(null),
  year: z.number().int().nullable().default(null),
  overview: z.string().nullable().default(null),
  images: imageSetSchema,
  rating: ratingSchema,
  genres: z.array(genreSchema).default([]),
  status: releaseStatusSchema.default("unknown"),
  /** Runtime in seconds for a single playable item. */
  durationSeconds: z.number().int().positive().nullable().default(null),
  /** True when the item has episodes (series, anime, K-drama). */
  isSeries: z.boolean().default(false),
  /** Deep link back to the provider (AniList page, TMDb page, YouTube watch URL). */
  sourceUrl: z.string().url().nullable().default(null),
});
export type MediaItem = z.infer<typeof mediaItemSchema>;

/* =============================================================================
 * Episodes & seasons
 * ========================================================================== */

export const episodeSchema = z.object({
  id: z.string(),
  seasonNumber: z.number().int().nonnegative(),
  episodeNumber: z.number().int().nonnegative(),
  title: z.string().nullable().default(null),
  overview: z.string().nullable().default(null),
  still: z.string().url().nullable().default(null),
  airDate: z.string().nullable().default(null),
  durationSeconds: z.number().int().positive().nullable().default(null),
});
export type Episode = z.infer<typeof episodeSchema>;

export const seasonSchema = z.object({
  id: z.string(),
  seasonNumber: z.number().int().nonnegative(),
  title: z.string().nullable().default(null),
  episodeCount: z.number().int().nonnegative().default(0),
  poster: z.string().url().nullable().default(null),
  episodes: z.array(episodeSchema).default([]),
});
export type Season = z.infer<typeof seasonSchema>;

/* =============================================================================
 * Full details page payload
 * ========================================================================== */

export const mediaDetailsSchema = mediaItemSchema.extend({
  tagline: z.string().nullable().default(null),
  /** Age/content rating for the user's region, e.g. "TV-MA", "PG-13". */
  certification: z.string().nullable().default(null),
  cast: z.array(castMemberSchema).default([]),
  seasons: z.array(seasonSchema).default([]),
  related: z.array(mediaItemSchema).default([]),
  studios: z.array(z.string()).default([]),
  countries: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  /** Provider-specific extras kept intact for future features. */
  external: z.record(z.string(), z.string()).default({}),
});
export type MediaDetails = z.infer<typeof mediaDetailsSchema>;

/* =============================================================================
 * Playback
 * ========================================================================== */

/** How a given item can actually be played. */
export const playbackKindSchema = z.enum([
  /** Local file on disk (Nova only). */
  "file",
  /** Embedded YouTube iframe. */
  "youtube",
  /** HTTP(S) stream from the user's own media server. */
  "stream",
  /** No in-app playback; deep-link out to the provider. */
  "external",
]);
export type PlaybackKind = z.infer<typeof playbackKindSchema>;

export const playbackSourceSchema = z.object({
  kind: playbackKindSchema,
  /** File path, stream URL, YouTube video id, or external URL. */
  locator: z.string(),
  mimeType: z.string().nullable().default(null),
  label: z.string().nullable().default(null),
  /** Higher wins when several sources exist for one item. */
  priority: z.number().int().default(0),
});
export type PlaybackSource = z.infer<typeof playbackSourceSchema>;
