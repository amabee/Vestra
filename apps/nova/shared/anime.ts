import type { MediaItem, PlaybackSource } from "@vestra/types";
export interface AnimeSourceTitle {
  handle: string;
  title: string;
}
export interface AnimeSourceEpisodes {
  item: MediaItem;
  queue: PlaybackSource[];
}
