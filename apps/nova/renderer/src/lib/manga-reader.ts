import type { MangaChapter } from "../../../shared/manga";

export interface ReaderOptions {
  layout: "single" | "double";
  direction: "ltr" | "rtl";
  fit: "height" | "width";
  zoom: number;
  firstPageAlone: boolean;
}
export const defaultReaderOptions: ReaderOptions = {
  layout: "single",
  direction: "ltr",
  fit: "height",
  zoom: 100,
  firstPageAlone: true,
};
export const readerOptionsKey = "vestra-manga-reader-v1";
export function parseReaderOptions(raw: string | null): ReaderOptions {
  try {
    const value = JSON.parse(raw ?? "null");
    return {
      layout: value?.layout === "double" ? "double" : "single",
      direction: value?.direction === "rtl" ? "rtl" : "ltr",
      fit: value?.fit === "width" ? "width" : "height",
      zoom:
        typeof value?.zoom === "number" && Number.isFinite(value.zoom)
          ? Math.min(200, Math.max(50, Math.round(value.zoom)))
          : 100,
      firstPageAlone:
        typeof value?.firstPageAlone === "boolean"
          ? value.firstPageAlone
          : true,
    };
  } catch {
    return { ...defaultReaderOptions };
  }
}
export function visiblePages(
  position: number,
  count: number,
  options: Pick<ReaderOptions, "layout" | "firstPageAlone">,
): number[] {
  if (count <= 0) return [];
  const page = Math.max(0, Math.min(Math.floor(position), count - 1));
  if (options.layout === "single" || (options.firstPageAlone && page === 0))
    return [page];
  const offset = options.firstPageAlone ? 1 : 0;
  const first = offset + Math.floor((page - offset) / 2) * 2;
  return first + 1 < count ? [first, first + 1] : [first];
}
export function adjacentPage(
  position: number,
  count: number,
  step: -1 | 1,
  options: Pick<ReaderOptions, "layout" | "firstPageAlone">,
): number {
  const visible = visiblePages(position, count, options);
  if (!visible.length) return 0;
  if (step === 1) return Math.min(count - 1, visible[visible.length - 1]! + 1);
  return visiblePages(Math.max(0, visible[0]! - 1), count, options)[0]!;
}
export function chapterSequence(
  chapters: MangaChapter[],
  language: string,
  scanlator: string,
): MangaChapter[] {
  return chapters
    .filter(
      (c) =>
        (!language || c.language === language) &&
        (!scanlator || c.scanlator === scanlator),
    )
    .toSorted((a, b) => a.index - b.index);
}
export function navigationKey(
  key: string,
  direction: ReaderOptions["direction"],
): -1 | 1 | null {
  if (key === "ArrowRight") return direction === "rtl" ? -1 : 1;
  if (key === "ArrowLeft") return direction === "rtl" ? 1 : -1;
  return null;
}
