/**
 * Sidebar navigation.
 *
 * `icon` is a lucide-react icon NAME, not a component, so this module stays
 * framework-agnostic and can be shared with Pulse (React Native) later.
 */

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: string;
  /** Rendered in a separate group below the main list. */
  section: "primary" | "library" | "system";
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "home", label: "Home", href: "/", icon: "House", section: "primary" },
  { id: "discover", label: "Discover", href: "/discover", icon: "Compass", section: "primary" },
  { id: "anime", label: "Anime", href: "/anime", icon: "Sparkles", section: "primary" },
  { id: "movies", label: "Movies", href: "/movies", icon: "Clapperboard", section: "primary" },
  { id: "tv", label: "TV Shows", href: "/tv", icon: "Tv", section: "primary" },
  { id: "kdrama", label: "K-Drama", href: "/kdrama", icon: "Heart", section: "primary" },
  { id: "youtube", label: "YouTube", href: "/youtube", icon: "Video", section: "primary" },
  { id: "local", label: "Local Library", href: "/local", icon: "HardDrive", section: "primary" },

  { id: "downloads", label: "Downloads", href: "/downloads", icon: "Download", section: "library" },
  { id: "watchlist", label: "Watchlist", href: "/watchlist", icon: "Bookmark", section: "library" },
  { id: "history", label: "History", href: "/history", icon: "History", section: "library" },

  { id: "settings", label: "Settings", href: "/settings", icon: "Settings", section: "system" },
] as const;

export const NAV_SECTIONS = [
  { id: "primary", label: null },
  { id: "library", label: "Library" },
  { id: "system", label: null },
] as const;
