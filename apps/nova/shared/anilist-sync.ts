import { z } from "zod";

export const aniListStatus = z.enum([
  "PLANNING",
  "CURRENT",
  "COMPLETED",
  "PAUSED",
  "DROPPED",
  "REPEATING",
]);
export const listChangeSchema = z
  .object({
    type: z.enum(["ANIME", "MANGA"]),
    mediaId: z.number().int().positive().max(2147483647).optional(),
    source: z.string().min(1).max(120),
    sourceId: z.string().min(1).max(4096),
    title: z.string().max(500).default(""),
    year: z.number().int().nullable().optional(),
    action: z.enum(["ensure", "status", "progress", "remove"]),
    status: aniListStatus.optional(),
    progress: z.number().int().min(0).max(100000).optional(),
    at: z.number(),
  })
  .refine(
    (value) => value.action !== "status" || value.status !== undefined,
    "Choose a list status.",
  );
export type AniListChange = z.infer<typeof listChangeSchema>;
export const remoteListEntrySchema = z.object({
  id: z.number().int().positive(),
  mediaId: z.number().int().positive(),
  status: aniListStatus,
  progress: z.number().int().nonnegative(),
  updatedAt: z.number(),
  media: z.object({
    id: z.number().int().positive(),
    type: z.enum(["ANIME", "MANGA"]),
    isAdult: z.boolean().nullish(),
    title: z.object({
      english: z.string().nullish(),
      romaji: z.string().nullish(),
      native: z.string().nullish(),
    }),
    coverImage: z.object({ large: z.string().url().nullish() }).nullish(),
    episodes: z.number().int().nullable(),
    chapters: z.number().int().nullable(),
    seasonYear: z.number().int().nullable(),
  }),
});
export type AniListRemoteEntry = z.infer<typeof remoteListEntrySchema>;
export const syncStateSchema = z
  .object({
    links: z
      .array(
        z.object({
          key: z.string().max(8500),
          mediaId: z.number().int().positive(),
        }),
      )
      .max(2000)
      .default([]),
    pending: z.array(listChangeSchema).max(1000).default([]),
    entries: z.array(remoteListEntrySchema).max(50000).default([]),
    managed: z.array(z.string().max(150)).max(50000).default([]),
    lastSyncAt: z.number().nullable().default(null),
    lastError: z.string().nullable().default(null),
    retryAt: z.number().nullable().default(null),
    unmatched: z.number().default(0),
  })
  .default({
    links: [],
    pending: [],
    entries: [],
    managed: [],
    lastSyncAt: null,
    lastError: null,
    retryAt: null,
    unmatched: 0,
  });
export const remoteEntryFields = `id mediaId status progress updatedAt media { id type isAdult title { english romaji native } coverImage { large } episodes chapters seasonYear }`;
