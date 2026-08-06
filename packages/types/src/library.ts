import { z } from "zod";

import { mediaItemSchema, mediaRefSchema } from "./media";

/* =============================================================================
 * Watchlist
 * ========================================================================== */

export const watchlistStatusSchema = z.enum([
  "planned",
  "watching",
  "completed",
  "paused",
  "dropped",
]);
export type WatchlistStatus = z.infer<typeof watchlistStatusSchema>;

export const watchlistEntrySchema = z.object({
  ref: mediaRefSchema,
  /** Denormalised snapshot so the watchlist renders offline without refetching. */
  snapshot: mediaItemSchema,
  status: watchlistStatusSchema.default("planned"),
  addedAt: z.number().int(),
  updatedAt: z.number().int(),
  userRating: z.number().min(0).max(100).nullable().default(null),
  notes: z.string().nullable().default(null),
});
export type WatchlistEntry = z.infer<typeof watchlistEntrySchema>;

/* =============================================================================
 * Watch progress — drives "Continue Watching" and resume.
 * ========================================================================== */

export const watchProgressSchema = z.object({
  ref: mediaRefSchema,
  /** Episode id for series; null for movies and single videos. */
  episodeId: z.string().nullable().default(null),
  positionSeconds: z.number().nonnegative().default(0),
  durationSeconds: z.number().nonnegative().default(0),
  /** Derived 0–1 completion, persisted so lists sort without recomputing. */
  percent: z.number().min(0).max(1).default(0),
  completed: z.boolean().default(false),
  updatedAt: z.number().int(),
});
export type WatchProgress = z.infer<typeof watchProgressSchema>;

/* =============================================================================
 * History
 * ========================================================================== */

export const historyEntrySchema = z.object({
  id: z.string(),
  ref: mediaRefSchema,
  snapshot: mediaItemSchema,
  episodeId: z.string().nullable().default(null),
  watchedAt: z.number().int(),
  positionSeconds: z.number().nonnegative().default(0),
  completed: z.boolean().default(false),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

/* =============================================================================
 * Episode bookmarks
 * ========================================================================== */

/**
 * A flagged episode.
 *
 * Distinct from the watchlist, which tracks whole titles. This marks one
 * episode inside one of them — a favourite, or somewhere worth returning to.
 * Nothing is copied from the file: a bookmark that outlives its file should
 * disappear rather than linger as a dead entry.
 */
export const episodeBookmarkSchema = z.object({
  ref: mediaRefSchema,
  /** Library file id. Null bookmarks the item as a whole. */
  episodeId: z.string().nullable().default(null),
  createdAt: z.number().int(),
});
export type EpisodeBookmark = z.infer<typeof episodeBookmarkSchema>;

/* =============================================================================
 * Local library
 * ========================================================================== */

export const localMediaFileSchema = z.object({
  id: z.string(),
  path: z.string(),
  fileName: z.string(),
  extension: z.string(),
  sizeBytes: z.number().nonnegative(),
  modifiedAt: z.number().int(),
  addedAt: z.number().int(),
  durationSeconds: z.number().positive().nullable().default(null),
  thumbnailPath: z.string().nullable().default(null),
  /** Title/season/episode parsed from the filename. */
  parsedTitle: z.string().nullable().default(null),
  parsedSeason: z.number().int().nullable().default(null),
  parsedEpisode: z.number().int().nullable().default(null),
  parsedYear: z.number().int().nullable().default(null),
  /** Set once the file is matched to a TMDb/AniList entry. */
  matchedRef: mediaRefSchema.nullable().default(null),
});
export type LocalMediaFile = z.infer<typeof localMediaFileSchema>;

export const localFolderSchema = z.object({
  id: z.string(),
  path: z.string(),
  label: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
  lastScannedAt: z.number().int().nullable().default(null),
  fileCount: z.number().int().nonnegative().default(0),
});
export type LocalFolder = z.infer<typeof localFolderSchema>;

export const scanStatusSchema = z.object({
  state: z.enum(["idle", "scanning", "error"]),
  folderId: z.string().nullable().default(null),
  filesFound: z.number().int().nonnegative().default(0),
  filesProcessed: z.number().int().nonnegative().default(0),
  error: z.string().nullable().default(null),
  startedAt: z.number().int().nullable().default(null),
  finishedAt: z.number().int().nullable().default(null),
});
export type ScanStatus = z.infer<typeof scanStatusSchema>;
