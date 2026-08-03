import { z } from "zod";

import { mediaItemSchema, mediaKindSchema, mediaSourceSchema } from "./media";

/* =============================================================================
 * Universal search
 * ========================================================================== */

export const searchQuerySchema = z.object({
  query: z.string().trim().min(1).max(200),
  /** Restrict to specific providers; empty means "every enabled source". */
  sources: z.array(mediaSourceSchema).default([]),
  kinds: z.array(mediaKindSchema).default([]),
  page: z.number().int().positive().default(1),
  perPage: z.number().int().positive().max(50).default(20),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** Results from a single provider, so one slow/failed source never blocks the rest. */
export const searchResultGroupSchema = z.object({
  source: mediaSourceSchema,
  label: z.string(),
  items: z.array(mediaItemSchema),
  totalResults: z.number().int().nonnegative().default(0),
  hasMore: z.boolean().default(false),
  /** Set when this provider failed; the UI degrades instead of erroring out. */
  error: z.string().nullable().default(null),
  /** Round-trip time in ms, surfaced in dev tooling. */
  elapsedMs: z.number().nonnegative().default(0),
});
export type SearchResultGroup = z.infer<typeof searchResultGroupSchema>;

export const searchResponseSchema = z.object({
  query: z.string(),
  groups: z.array(searchResultGroupSchema),
  totalResults: z.number().int().nonnegative(),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export const recentSearchSchema = z.object({
  query: z.string(),
  searchedAt: z.number().int(),
});
export type RecentSearch = z.infer<typeof recentSearchSchema>;

/* =============================================================================
 * Discovery rows (home page carousels)
 * ========================================================================== */

export const DISCOVER_ROW_IDS = [
  "continue-watching",
  "trending-anime",
  "trending-movies",
  "trending-kdrama",
  "trending-tv",
  "recommended",
  "recently-added-local",
] as const;

export const discoverRowIdSchema = z.enum(DISCOVER_ROW_IDS);
export type DiscoverRowId = z.infer<typeof discoverRowIdSchema>;

export const discoverRowSchema = z.object({
  id: discoverRowIdSchema,
  title: z.string(),
  subtitle: z.string().nullable().default(null),
  items: z.array(mediaItemSchema),
  /** Route for the row's "See all" affordance. */
  href: z.string().nullable().default(null),
});
export type DiscoverRow = z.infer<typeof discoverRowSchema>;
