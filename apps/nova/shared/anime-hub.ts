import type { MediaItem, WatchlistStatus } from "@vestra/types";

export interface AnimeCatalogueTitle {
  item: MediaItem;
  totalEpisodes: number | null;
  airedEpisodes: number | null;
  season: string | null;
  format: string | null;
}
export interface AnimeExploreQuery {
  genre?: string;
  year?: number | null;
  status?: string;
  format?: string;
  season?: string;
}
export interface AnimeExplorePage {
  genres: string[];
  sections: { id: string; title: string; items: AnimeCatalogueTitle[] }[];
}
export interface AnimeScheduleEvent {
  id: string;
  airingAt: number;
  episode: number;
  item: MediaItem;
  status: WatchlistStatus;
  watched: boolean;
}
export interface AnimeSchedulePage {
  events: AnimeScheduleEvent[];
  unmatched: string[];
  tracked: number;
  truncated: boolean;
}
