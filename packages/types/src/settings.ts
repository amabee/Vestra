import { z } from "zod";

import { mediaSourceSchema } from "./media";
import { localFolderSchema } from "./library";
import { mediaServerConnectionSchema } from "./torrent";

/* =============================================================================
 * Appearance
 * ========================================================================== */

export const themeModeSchema = z.enum(["dark", "light", "system"]);
export type ThemeMode = z.infer<typeof themeModeSchema>;

export const ACCENT_PRESETS = [
  "violet",
  "electric",
  "emerald",
  "rose",
  "amber",
  "cyan",
] as const;

export const accentPresetSchema = z.enum(ACCENT_PRESETS);
export type AccentPreset = z.infer<typeof accentPresetSchema>;

export const appearanceSettingsSchema = z.object({
  theme: themeModeSchema.default("dark"),
  accent: accentPresetSchema.default("violet"),
  /** Overrides `accent` when set. Hex, e.g. #7C3AED. */
  customAccent: z
    .string()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
    .nullable()
    .default(null),
  glassEffects: z.boolean().default(true),
  reducedMotion: z.boolean().default(false),
  sidebarCollapsed: z.boolean().default(false),
});
export type AppearanceSettings = z.infer<typeof appearanceSettingsSchema>;

/* =============================================================================
 * Sources
 * ========================================================================== */

export const sourceSettingsSchema = z.object({
  enabled: z.array(mediaSourceSchema).default(["tmdb", "anilist", "youtube", "local"]),
  /** Ordering of result groups in universal search. */
  order: z.array(mediaSourceSchema).default(["tmdb", "anilist", "youtube", "local"]),
  /** Set once the user has completed AniList OAuth (token lives in keytar/httpOnly cookie). */
  anilistConnected: z.boolean().default(false),
  anilistUsername: z.string().nullable().default(null),
});
export type SourceSettings = z.infer<typeof sourceSettingsSchema>;

/* =============================================================================
 * Playback
 * ========================================================================== */

export const playbackSettingsSchema = z.object({
  autoplayNext: z.boolean().default(true),
  /** Fraction of runtime after which an item counts as watched. */
  markWatchedAt: z.number().min(0.5).max(1).default(0.9),
  /** Skip-forward/back step in seconds. */
  seekStepSeconds: z.number().int().positive().default(10),
  defaultVolume: z.number().min(0).max(1).default(1),
  preferredSubtitleLanguage: z.string().default("en"),
  preferredAudioLanguage: z.string().default("en"),
  /** Resume rather than restart when progress is between 1% and `markWatchedAt`. */
  rememberPosition: z.boolean().default(true),
});
export type PlaybackSettings = z.infer<typeof playbackSettingsSchema>;

/* =============================================================================
 * Library
 * ========================================================================== */

export const librarySettingsSchema = z.object({
  folders: z.array(localFolderSchema).default([]),
  /** Extensions treated as video, lowercase and without the leading dot. */
  videoExtensions: z
    .array(z.string())
    .default(["mp4", "mkv", "avi", "mov", "webm", "m4v", "wmv", "flv", "ts"]),
  scanOnStartup: z.boolean().default(true),
  generateThumbnails: z.boolean().default(true),
  /** Attempt automatic TMDb/AniList matching for scanned files. */
  autoMatchMetadata: z.boolean().default(true),
});
export type LibrarySettings = z.infer<typeof librarySettingsSchema>;

/* =============================================================================
 * Downloads (qBittorrent)
 * ========================================================================== */

export const downloadSettingsSchema = z.object({
  qbittorrentEnabled: z.boolean().default(false),
  qbittorrentUrl: z.string().default("http://localhost:8080"),
  /** Category applied to torrents Vestra adds, so it only manages its own. */
  category: z.string().default("vestra"),
  /** Poll interval for the downloads view, in ms. */
  pollIntervalMs: z.number().int().min(1000).default(3000),
  /** Import completed downloads into the local library automatically. */
  autoImportCompleted: z.boolean().default(true),
});
export type DownloadSettings = z.infer<typeof downloadSettingsSchema>;

/* =============================================================================
 * Privacy
 * ========================================================================== */

export const privacySettingsSchema = z.object({
  trackHistory: z.boolean().default(true),
  /** 0 = keep forever. */
  historyRetentionDays: z.number().int().nonnegative().default(0),
  shareAnonymousUsage: z.boolean().default(false),
  /** Blur posters flagged as adult content. */
  blurAdultContent: z.boolean().default(true),
  showAdultContent: z.boolean().default(false),
});
export type PrivacySettings = z.infer<typeof privacySettingsSchema>;

/* =============================================================================
 * Extensions
 * ========================================================================== */

export const extensionSettingsSchema = z.object({
  /**
   * Registry URLs the user has added.
   *
   * Deliberately empty by default. Vestra ships no bundled marketplace, so
   * pointing at a third-party index is an explicit choice the user makes.
   */
  registries: z.array(z.string().url()).default([]),
  /** Extension ids the user has enabled. */
  enabled: z.array(z.string()).default([]),
});
export type ExtensionSettings = z.infer<typeof extensionSettingsSchema>;

/* =============================================================================
 * Root settings document
 * ========================================================================== */

/**
 * Root settings document.
 *
 * Nested sections use `.prefault({})` rather than `.default({})`: in Zod 4,
 * `.default()` expects the fully-populated OUTPUT type, whereas `.prefault()`
 * feeds the value through the schema so each section's own defaults apply.
 */
export const settingsSchema = z.object({
  version: z.literal(1).default(1),
  appearance: appearanceSettingsSchema.prefault({}),
  sources: sourceSettingsSchema.prefault({}),
  playback: playbackSettingsSchema.prefault({}),
  library: librarySettingsSchema.prefault({}),
  downloads: downloadSettingsSchema.prefault({}),
  privacy: privacySettingsSchema.prefault({}),
  extensions: extensionSettingsSchema.prefault({}),
  mediaServer: mediaServerConnectionSchema.prefault({}),
});
export type Settings = z.infer<typeof settingsSchema>;

/** Fully-populated defaults, produced by the schema itself so they never drift. */
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});
