export interface MangaBook {
  id: string;
  title: string;
  cover?: string;
}
export interface MangaChapter {
  id: string;
  title: string;
  chapter: string;
  index: number;
  language?: string;
  scanlator?: string;
}
export interface MangaPage {
  handle: string;
  index: number;
}
export interface ReadingProgress {
  chapterId: string;
  page: number;
  updatedAt: string;
}
export interface MangaRecent {
  entries: { book: MangaBook; progress: ReadingProgress }[];
  unreadable: number;
  truncated: boolean;
}
export interface MangaDiscoveryQuery {
  sort: "popular" | "trending" | "score" | "newest";
  origin: "all" | "JP" | "KR" | "CN";
  genre: string;
  status: "all" | "RELEASING" | "FINISHED";
  page: number;
}
export interface MangaDiscoveryTitle {
  id: number;
  title: string;
  cover?: string;
  genres: string[];
  origin: string | null;
  status: string | null;
  score: number | null;
}
export interface MangaDiscoveryPage {
  items: MangaDiscoveryTitle[];
  genres: string[];
  hasNextPage: boolean;
  page: number;
  stale: boolean;
}
