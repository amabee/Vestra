import { z } from "zod";

const id = z.string().min(1).max(4096);
const httpsUrl = z
  .string()
  .url()
  .max(4096)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Must be an HTTPS URL without credentials.");
const headers = z
  .record(z.string().max(100), z.string().max(4096))
  .refine(
    (value) => Object.keys(value).length <= 32,
    "Too many image headers.",
  );
export const mangaAssetSchema = z.object({
  url: httpsUrl,
  headers: headers.default({}),
});
export const mangaTitleSchema = z.object({
  id,
  title: z.string().min(1).max(500),
  cover: mangaAssetSchema.nullish(),
});
export const mangaChapterSchema = z.object({
  id,
  title: z.string().max(500),
  number: z.string().min(1).max(100),
  index: z.number().int().nonnegative(),
  language: z.string().max(100).optional(),
  scanlator: z.string().max(500).optional(),
});
export const mangaPageSchema = mangaAssetSchema.extend({
  index: z.number().int().nonnegative(),
});
export const mangaSearchResultsSchema = z.array(mangaTitleSchema).max(400);
export const mangaSearchPageSchema = z.object({
  items: mangaSearchResultsSchema,
  hasMore: z.boolean(),
});
export const mangaChaptersSchema = z
  .array(mangaChapterSchema)
  .max(10000)
  .refine(
    (rows) => new Set(rows.map((row) => row.id)).size === rows.length,
    "Chapter IDs must be unique.",
  );
export const mangaPagesSchema = z
  .array(mangaPageSchema)
  .max(2000)
  .refine(
    (rows) => new Set(rows.map((row) => row.index)).size === rows.length,
    "Page indexes must be unique.",
  );
export const MANGA_SOURCE_METHODS = [
  "search",
  "getChapters",
  "getPages",
] as const;
export type MangaSourceTitle = z.input<typeof mangaTitleSchema>;
export type MangaSourceChapter = z.infer<typeof mangaChapterSchema>;
export type MangaSourcePage = z.input<typeof mangaPageSchema>;

export function assertMangaSourceMethods(
  role: string | undefined,
  methods: readonly string[],
) {
  if (
    role === "manga-source" &&
    !MANGA_SOURCE_METHODS.every((method) => methods.includes(method))
  )
    throw new Error(
      "A manga source must export search, getChapters and getPages.",
    );
}

export interface MangaSourceExtension {
  search(
    query: string,
    options: { limit: number },
  ): MangaSourceTitle[] | Promise<MangaSourceTitle[]>;
  searchPage?(
    query: string,
    options: { page: number; limit: number },
  ):
    | { items: MangaSourceTitle[]; hasMore: boolean }
    | Promise<{ items: MangaSourceTitle[]; hasMore: boolean }>;
  getChapters(
    bookId: string,
  ): MangaSourceChapter[] | Promise<MangaSourceChapter[]>;
  getPages(chapterId: string): MangaSourcePage[] | Promise<MangaSourcePage[]>;
}
