import type { MediaItem, PlaybackSource } from "@vestra/types";
import type { DiscoveryCategory } from "@vestra/extension-host";
export interface AnimeDiscoveryPage {
  mode: "source" | "catalogue";
  categories: readonly DiscoveryCategory[];
  category: DiscoveryCategory;
  page: number;
  hasMore: boolean;
  items: MediaItem[];
}
export interface AnimeSourceTitle {
  handle: string;
  title: string;
}
export interface AnimeSourceEpisodes {
  providerTitle?: string;
  item: MediaItem;
  queue: PlaybackSource[];
}
