import { z } from "zod";
import type { MangaArtwork } from "./manga-service";
import type { CSharpProviderSession } from "./csharp-worker";

export interface SavedMangaRecord {
  kind: "source" | "catalogue";
  source: string;
  id: string;
  title: string;
  cover?: MangaArtwork | null;
  savedAt: string;
}
export interface MangaBookmarkRepository {
  list(): Promise<SavedMangaRecord[]>;
  set(entry: Omit<SavedMangaRecord, "savedAt">, saved: boolean): Promise<void>;
}
const savedSchema = z.object({
  kind: z.enum(["source", "catalogue"]),
  source: z.string().min(1).max(120),
  id: z.string().min(1).max(4096),
  title: z.string().min(1).max(4096),
  cover: z
    .object({
      url: z.string().url().max(4096),
      headers: z.record(z.string(), z.string()).nullish(),
    })
    .nullish(),
  savedAt: z.string().datetime({ offset: true }),
});
export function csharpMangaBookmarks(
  client: Pick<CSharpProviderSession, "request">,
): MangaBookmarkRepository {
  return {
    async list() {
      return z
        .array(savedSchema)
        .max(500)
        .parse(await client.request({ kind: "bookmarks:list" }))
        .map((row) => ({
          ...row,
          cover: row.cover
            ? { url: row.cover.url, headers: row.cover.headers ?? {} }
            : null,
        }));
    },
    async set(entry, saved) {
      await client.request({ kind: "bookmarks:set", entry, saved });
    },
  };
}
