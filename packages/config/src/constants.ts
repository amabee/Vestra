import type { MediaSource } from "@vestra/types";

/* =============================================================================
 * Provider endpoints
 * ========================================================================== */

export const TMDB_API_BASE = "https://api.themoviedb.org/3";
export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
export const ANILIST_GRAPHQL_ENDPOINT = "https://graphql.anilist.co";
export const ANILIST_OAUTH_AUTHORIZE = "https://anilist.co/api/v2/oauth/authorize";
export const ANILIST_OAUTH_TOKEN = "https://anilist.co/api/v2/oauth/token";
export const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
export const YOUTUBE_WATCH_BASE = "https://www.youtube.com/watch";
export const YOUTUBE_EMBED_BASE = "https://www.youtube-nocookie.com/embed";

/* =============================================================================
 * TMDb image sizing — pick the smallest asset that still looks sharp.
 * ========================================================================== */

export const TMDB_IMAGE_SIZES = {
  poster: {
    small: "w185",
    medium: "w342",
    large: "w500",
    original: "original",
  },
  backdrop: {
    small: "w300",
    medium: "w780",
    large: "w1280",
    original: "original",
  },
  profile: {
    small: "w45",
    medium: "w185",
    large: "h632",
  },
  still: {
    small: "w92",
    medium: "w300",
  },
} as const;

/**
 * TMDb genre id used to isolate K-dramas, combined with `with_origin_country=KR`.
 * TMDb has no dedicated "K-drama" category, so Vestra composes one.
 */
export const KDRAMA_DISCOVER_PARAMS = {
  with_origin_country: "KR",
  sort_by: "popularity.desc",
} as const;

export const ANIME_ORIGIN_COUNTRY = "JP";

/* =============================================================================
 * Source presentation
 * ========================================================================== */

export interface SourceMeta {
  id: MediaSource;
  label: string;
  shortLabel: string;
  /** Tailwind class fragment used for the source chip. */
  accentClass: string;
  description: string;
}

export const SOURCE_META: Record<MediaSource, SourceMeta> = {
  tmdb: {
    id: "tmdb",
    label: "Movies & TV",
    shortLabel: "TMDb",
    accentClass: "text-emerald-400",
    description: "Movies, TV shows and K-dramas from The Movie Database",
  },
  anilist: {
    id: "anilist",
    label: "Anime",
    shortLabel: "AniList",
    accentClass: "text-violet-soft",
    description: "Anime catalogue and tracking from AniList",
  },
  youtube: {
    id: "youtube",
    label: "YouTube",
    shortLabel: "YouTube",
    accentClass: "text-red-400",
    description: "Videos from the YouTube Data API",
  },
  local: {
    id: "local",
    label: "Local Library",
    shortLabel: "Local",
    accentClass: "text-electric",
    description: "Video files on this machine",
  },
  mediaserver: {
    id: "mediaserver",
    label: "Media Server",
    shortLabel: "Server",
    accentClass: "text-amber-400",
    description: "Your own Jellyfin or Plex server",
  },
  qbittorrent: {
    id: "qbittorrent",
    label: "Downloads",
    shortLabel: "qBit",
    accentClass: "text-sky-400",
    description: "Transfers in your qBittorrent client",
  },
};

/* =============================================================================
 * Caching & timing
 * ========================================================================== */

/** Revalidation windows in seconds, for Next.js fetch caching. */
export const CACHE_TTL = {
  /** Trending rows move slowly; an hour is plenty. */
  trending: 60 * 60,
  /** Details pages are effectively static. */
  details: 60 * 60 * 12,
  /** Search must feel live. */
  search: 60,
  /** Downloads change constantly — never cache. */
  realtime: 0,
} as const;

export const SEARCH_DEBOUNCE_MS = 250;
export const MAX_RECENT_SEARCHES = 8;
export const PROVIDER_TIMEOUT_MS = 8_000;

/* =============================================================================
 * Storage keys
 * ========================================================================== */

export const STORAGE_KEYS = {
  settings: "settings",
  watchlist: "watchlist",
  history: "history",
  progress: "progress",
  /** Per-episode flags, keyed the same way progress is. */
  bookmarks: "bookmarks",
  localLibrary: "local-library",
  recentSearches: "recent-searches",
  /** Installed community extensions. Code is stored separately, content-addressed. */
  extensions: "extensions",
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/* =============================================================================
 * Accent presets
 *
 * Each preset overrides the handful of CSS custom properties that carry the
 * accent through the whole design system, so switching one value restyles
 * buttons, rings, gradients and the active nav rail together.
 * ========================================================================== */

export interface AccentTokens {
  label: string;
  /** Swatch shown in the settings picker. */
  swatch: string;
  vars: Record<string, string>;
}

export const ACCENT_TOKENS: Record<string, AccentTokens> = {
  violet: {
    label: "Violet",
    swatch: "oklch(0.606 0.25 292.717)",
    vars: {
      "--primary": "oklch(0.606 0.25 292.717)",
      "--ring": "oklch(0.606 0.25 292.717)",
      "--violet": "oklch(0.606 0.25 292.717)",
      "--violet-soft": "oklch(0.702 0.183 293.541)",
      "--sidebar-primary": "oklch(0.606 0.25 292.717)",
      "--sidebar-ring": "oklch(0.606 0.25 292.717)",
    },
  },
  electric: {
    label: "Electric Blue",
    swatch: "oklch(0.685 0.169 237.323)",
    vars: {
      "--primary": "oklch(0.685 0.169 237.323)",
      "--ring": "oklch(0.685 0.169 237.323)",
      "--violet": "oklch(0.685 0.169 237.323)",
      "--violet-soft": "oklch(0.746 0.16 232.661)",
      "--sidebar-primary": "oklch(0.685 0.169 237.323)",
      "--sidebar-ring": "oklch(0.685 0.169 237.323)",
    },
  },
  emerald: {
    label: "Emerald",
    swatch: "oklch(0.696 0.17 162.48)",
    vars: {
      "--primary": "oklch(0.696 0.17 162.48)",
      "--ring": "oklch(0.696 0.17 162.48)",
      "--violet": "oklch(0.696 0.17 162.48)",
      "--violet-soft": "oklch(0.765 0.177 163.223)",
      "--sidebar-primary": "oklch(0.696 0.17 162.48)",
      "--sidebar-ring": "oklch(0.696 0.17 162.48)",
    },
  },
  rose: {
    label: "Rose",
    swatch: "oklch(0.645 0.246 16.439)",
    vars: {
      "--primary": "oklch(0.645 0.246 16.439)",
      "--ring": "oklch(0.645 0.246 16.439)",
      "--violet": "oklch(0.645 0.246 16.439)",
      "--violet-soft": "oklch(0.712 0.194 13.428)",
      "--sidebar-primary": "oklch(0.645 0.246 16.439)",
      "--sidebar-ring": "oklch(0.645 0.246 16.439)",
    },
  },
  amber: {
    label: "Amber",
    swatch: "oklch(0.769 0.188 70.08)",
    vars: {
      "--primary": "oklch(0.769 0.188 70.08)",
      "--ring": "oklch(0.769 0.188 70.08)",
      "--violet": "oklch(0.769 0.188 70.08)",
      "--violet-soft": "oklch(0.828 0.189 84.429)",
      "--sidebar-primary": "oklch(0.769 0.188 70.08)",
      "--sidebar-ring": "oklch(0.769 0.188 70.08)",
    },
  },
  cyan: {
    label: "Cyan",
    swatch: "oklch(0.715 0.143 215.221)",
    vars: {
      "--primary": "oklch(0.715 0.143 215.221)",
      "--ring": "oklch(0.715 0.143 215.221)",
      "--violet": "oklch(0.715 0.143 215.221)",
      "--violet-soft": "oklch(0.789 0.154 211.53)",
      "--sidebar-primary": "oklch(0.715 0.143 215.221)",
      "--sidebar-ring": "oklch(0.715 0.143 215.221)",
    },
  },
};
