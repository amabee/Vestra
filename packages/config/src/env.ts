import { z } from "zod";

/**
 * Server-side environment.
 *
 * Validated lazily via `getServerEnv()` rather than at module load, so importing
 * this file from a client bundle or during `next build` never explodes on a
 * missing key. Providers degrade individually instead of taking down the app.
 */

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // TMDb — v4 bearer token preferred, v3 key as fallback.
  TMDB_ACCESS_TOKEN: z.string().optional(),
  TMDB_API_KEY: z.string().optional(),

  // AniList — only needed for user-account OAuth, not public queries.
  ANILIST_CLIENT_ID: z.string().optional(),
  ANILIST_CLIENT_SECRET: z.string().optional(),
  ANILIST_REDIRECT_URI: z.string().optional(),

  // YouTube Data API v3.
  YOUTUBE_API_KEY: z.string().optional(),

  // Personal media server.
  MEDIA_SERVER_KIND: z.enum(["none", "jellyfin", "plex"]).default("none"),
  MEDIA_SERVER_URL: z.string().optional(),
  MEDIA_SERVER_API_KEY: z.string().optional(),

  // qBittorrent Web UI (the user's own client).
  QBITTORRENT_URL: z.string().optional(),
  QBITTORRENT_USERNAME: z.string().optional(),
  QBITTORRENT_PASSWORD: z.string().optional(),

  // Where Vestra writes its JSON documents.
  VESTRA_DATA_DIR: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | null = null;

/** Parse and cache server environment. Throws only if a present value is malformed. */
export function getServerEnv(): ServerEnv {
  if (cachedEnv) return cachedEnv;

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid Vestra environment configuration:\n${issues}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

/* -----------------------------------------------------------------------------
 * Per-provider availability. The UI uses these to hide sources that
 * aren't configured rather than showing broken sections.
 * -------------------------------------------------------------------------- */

export function isTmdbConfigured(): boolean {
  const env = getServerEnv();
  return Boolean(env.TMDB_ACCESS_TOKEN ?? env.TMDB_API_KEY);
}

/** AniList public GraphQL needs no credentials, so it is always available. */
export function isAnilistConfigured(): boolean {
  return true;
}

export function isYoutubeConfigured(): boolean {
  return Boolean(getServerEnv().YOUTUBE_API_KEY);
}

export function isQbittorrentConfigured(): boolean {
  const env = getServerEnv();
  return Boolean(env.QBITTORRENT_URL && env.QBITTORRENT_USERNAME);
}

export function isMediaServerConfigured(): boolean {
  const env = getServerEnv();
  return env.MEDIA_SERVER_KIND !== "none" && Boolean(env.MEDIA_SERVER_URL);
}

/** Client-safe values. Anything here is allowed to reach the browser. */
export const publicEnv = {
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "Vestra",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
} as const;
