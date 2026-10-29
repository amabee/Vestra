import type { MangaChapter } from "../../../shared/manga";

export interface ReaderOptions {
  layout: "single" | "double" | "continuous" | "webtoon";
  direction: "ltr" | "rtl";
  fit: "height" | "width" | "page" | "original";
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
export const seriesOptionsKey = (provider: string, book: string) =>
  `${readerOptionsKey}:${JSON.stringify([provider, book])}`;
export const isVerticalLayout = (layout: ReaderOptions["layout"]) =>
  layout === "continuous" || layout === "webtoon";
export function recommendLayout(
  width: number,
  height: number,
): ReaderOptions["layout"] | null {
  return width > 0 && height / width >= 2.5 ? "webtoon" : null;
}
export function parseReaderOptions(raw: string | null): ReaderOptions {
  try {
    const value = JSON.parse(raw ?? "null");
    return {
      layout: ["single", "double", "continuous", "webtoon"].includes(
        value?.layout,
      )
        ? value.layout
        : "single",
      direction: value?.direction === "rtl" ? "rtl" : "ltr",
      fit: ["height", "width", "page", "original"].includes(value?.fit)
        ? value.fit
        : "height",
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
  if (options.layout !== "double" || (options.firstPageAlone && page === 0))
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
