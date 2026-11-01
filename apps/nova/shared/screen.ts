import type { MediaItem, PlaybackSource } from "@vestra/types";
import type { DiscoveryCategory } from "@vestra/extension-host";

export type ScreenKind = "movie" | "tv";
export interface ScreenSource {
  id: string;
  name: string;
  categories: readonly DiscoveryCategory[];
}
export interface ScreenPage {
  items: MediaItem[];
  hasMore: boolean;
}
export interface ScreenPlayback {
  item: MediaItem;
  queue: PlaybackSource[];
}
