import { z } from "zod";
import type { StorageDriver } from "@vestra/storage";
import type { MangaBook, MangaInformation } from "../shared/manga";
import type { MangaService } from "./manga-service";

const mapping = z.object({
  provider: z.string().min(1).max(120),
  key: z.string().max(8192),
  book: z.object({
    id: z.string().min(1).max(4096),
    title: z.string().min(1).max(4096),
  }),
  expires: z.number(),
});
/** Catalogue and provider IDs are different identities. Only unique exact title/alias
 * matches are saved, always scoped to the selected provider. Covers stay main-owned. */
export class MangaTitleResolver {
  private rows: z.infer<typeof mapping>[] = [];
  private loading: Promise<void> | null = null;
  private writes = Promise.resolve();
  private pending = new Map<
    string,
    { version: object; work: Promise<MangaBook | null> }
  >();
  constructor(
    private driver: StorageDriver,
    private service: MangaService,
    private information: (id: number) => Promise<MangaInformation | null>,
  ) {}
  private load() {
    return (this.loading ??= (async () => {
      try {
        this.rows = z
          .array(mapping)
          .max(256)
          .parse(await this.driver.read("manga-provider-mappings-v1"));
      } catch {
        /* Optional identity cache. */
      }
    })());
  }
  catalogue(provider: string, id: number) {
    z.number().int().positive().parse(id);
    return this.resolve(provider, `anilist:${id}`, async () => {
      const info = await this.information(id);
      return info ? [info.title, ...info.titles] : [];
    });
  }
  source(provider: string, origin: string, id: string, title?: string) {
    if (provider === origin)
      return this.service.resolveBook(provider, id, title);
    return this.resolve(provider, JSON.stringify([origin, id]), async () => {
      // The original bookmark may outlive the original source installation.
      const saved = (await this.service.bookmarks()).find(
        (row) =>
          row.kind === "source" && row.source === origin && row.book.id === id,
      );
      let book = saved?.book;
      if (!book) book = await this.service.resolveBook(origin, id, title);
      return [book.title];
    });
  }
  private async resolve(
    provider: string,
    key: string,
    titles: () => Promise<string[]>,
  ): Promise<MangaBook | null> {
    const version = this.service.sourceVersion(provider);
    const identity = JSON.stringify([provider, key]);
    const pending = this.pending.get(identity);
    if (pending?.version === version) return pending.work;
    if (this.pending.size >= 8)
      throw new Error("Manga matching is busy. Retry shortly.");
    const work = (async () => {
      await this.load();
      const stored = this.rows.find(
        (row) =>
          row.provider === provider &&
          row.key === key &&
          row.expires > Date.now(),
      );
      if (stored) {
        try {
          const book = await this.service.resolveBook(
            provider,
            stored.book.id,
            stored.book.title,
          );
          if (this.service.sourceVersion(provider) !== version)
            throw new Error("Manga source changed.");
          return book;
        } catch {
          if (this.service.sourceVersion(provider) !== version)
            throw new Error("Manga source changed.");
          // A renamed/removed provider ID must be matched again, never substituted by ID.
        }
      }
      const book = await this.service.matchTitles(provider, await titles());
      if (this.service.sourceVersion(provider) !== version)
        throw new Error("Manga source changed.");
      this.rows = this.rows.filter(
        (row) => !(row.provider === provider && row.key === key),
      );
      if (book)
        this.rows.push({
          provider,
          key,
          book: { id: book.id, title: book.title },
          expires: Date.now() + 7 * 24 * 60 * 60_000,
        });
      this.rows = this.rows.slice(-256);
      const snapshot = [...this.rows];
      this.writes = this.writes
        .then(() => this.driver.write("manga-provider-mappings-v1", snapshot))
        .catch(() => undefined);
      await this.writes;
      return book;
    })();
    this.pending.set(identity, { version, work });
    void work
      .finally(() => {
        if (this.pending.get(identity)?.work === work)
          this.pending.delete(identity);
      })
      .catch(() => undefined);
    return work;
  }
}
