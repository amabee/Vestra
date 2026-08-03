import { z } from "zod";

/* =============================================================================
 * qBittorrent — control of the user's OWN client via its Web API.
 * Vestra ships no indexers or trackers; it only drives a client you point it at.
 * ========================================================================== */

export const torrentStateSchema = z.enum([
  "downloading",
  "seeding",
  "paused",
  "queued",
  "checking",
  "stalled",
  "error",
  "completed",
  "unknown",
]);
export type TorrentState = z.infer<typeof torrentStateSchema>;

export const torrentSchema = z.object({
  hash: z.string(),
  name: z.string(),
  state: torrentStateSchema,
  /** 0–1 completion. */
  progress: z.number().min(0).max(1).default(0),
  sizeBytes: z.number().nonnegative().default(0),
  downloadedBytes: z.number().nonnegative().default(0),
  downloadSpeed: z.number().nonnegative().default(0),
  uploadSpeed: z.number().nonnegative().default(0),
  /** Seconds remaining; null when unknown or complete. */
  etaSeconds: z.number().nonnegative().nullable().default(null),
  savePath: z.string(),
  /** Absolute path to the finished content, once available. */
  contentPath: z.string().nullable().default(null),
  category: z.string().default(""),
  tags: z.array(z.string()).default([]),
  addedAt: z.number().int().nullable().default(null),
  completedAt: z.number().int().nullable().default(null),
});
export type Torrent = z.infer<typeof torrentSchema>;

export const torrentFileSchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string(),
  sizeBytes: z.number().nonnegative(),
  progress: z.number().min(0).max(1).default(0),
  priority: z.number().int().default(1),
});
export type TorrentFile = z.infer<typeof torrentFileSchema>;

export const addTorrentInputSchema = z.object({
  /** Magnet URI or http(s) link to a .torrent file. */
  urls: z.array(z.string().min(1)).min(1),
  savePath: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  paused: z.boolean().default(false),
});
export type AddTorrentInput = z.infer<typeof addTorrentInputSchema>;

export const qbittorrentConnectionSchema = z.object({
  /** Base URL of the qBittorrent Web UI, e.g. http://localhost:8080 */
  url: z.string().url(),
  username: z.string(),
  password: z.string(),
});
export type QbittorrentConnection = z.infer<typeof qbittorrentConnectionSchema>;

export const qbittorrentStatusSchema = z.object({
  connected: z.boolean(),
  version: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
});
export type QbittorrentStatus = z.infer<typeof qbittorrentStatusSchema>;

/* =============================================================================
 * Personal media server (Jellyfin / Plex)
 * ========================================================================== */

export const mediaServerKindSchema = z.enum(["none", "jellyfin", "plex"]);
export type MediaServerKind = z.infer<typeof mediaServerKindSchema>;

export const mediaServerConnectionSchema = z.object({
  kind: mediaServerKindSchema.default("none"),
  url: z.string().url().nullable().default(null),
  apiKey: z.string().nullable().default(null),
  userId: z.string().nullable().default(null),
});
export type MediaServerConnection = z.infer<typeof mediaServerConnectionSchema>;

export const mediaServerStatusSchema = z.object({
  connected: z.boolean(),
  serverName: z.string().nullable().default(null),
  version: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
});
export type MediaServerStatus = z.infer<typeof mediaServerStatusSchema>;
