export interface MangaBook {
  id: string;
  title: string;
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
