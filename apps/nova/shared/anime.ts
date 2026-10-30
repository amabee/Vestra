import type { MediaItem, PlaybackSource } from "@vestra/types";
export interface AnimeSourceTitle {
  handle: string;
  title: string;
}
export interface AnimeSourceEpisodes {
  providerTitle?: string;
  item: MediaItem;
  queue: PlaybackSource[];
}
