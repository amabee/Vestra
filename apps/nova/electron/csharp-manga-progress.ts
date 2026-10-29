import { z } from "zod";
import type { CSharpProviderSession } from "./csharp-worker";
import type { ReadingProgressRepository } from "./manga-service";

const position = z.object({
  chapterId: z.string().min(1).max(4096),
  page: z.number().int().min(0).max(1999),
  updatedAt: z.string().datetime({ offset: true }),
});

export function csharpMangaProgress(
  client: Pick<CSharpProviderSession, "request">,
  providerId: string,
): ReadingProgressRepository {
  return {
    async read(bookId) {
      return position
        .nullable()
        .parse(
          await client.request({ kind: "progress:get", providerId, bookId }),
        );
    },
    async recent() {
      const result = z
        .object({
          entries: z
            .array(
              z.object({
                providerId: z.literal(providerId),
                bookId: z.string().min(1).max(4096),
                title: z.string().min(1).max(4096),
                progress: position,
                cover: z
                  .object({
                    url: z.string().url().max(4096),
                    headers: z.record(z.string(), z.string()).nullish(),
                  })
                  .nullish(),
              }),
            )
            .max(12),
          unreadable: z.number().int().nonnegative(),
          truncated: z.boolean(),
        })
        .parse(await client.request({ kind: "progress:recent", providerId }));
      return {
        ...result,
        entries: result.entries.map((r) => ({
          book: { id: r.bookId, title: r.title },
          progress: r.progress,
          artwork: r.cover
            ? { url: r.cover.url, headers: r.cover.headers ?? {} }
            : undefined,
        })),
      };
    },
    async save(bookId, chapterId, page, pageCount, title, cover) {
      await client.request({
        kind: "progress:save",
        providerId,
        bookId,
        chapterId,
        page,
        pageCount,
        title,
        cover,
      });
    },
    async import(bookId, progress) {
      return position.parse(
        await client.request({
          kind: "progress:import",
          providerId,
          bookId,
          progress,
        }),
      );
    },
  };
}
