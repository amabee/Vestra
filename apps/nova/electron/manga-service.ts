import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { MangaCoverCache } from "./manga-cover-cache";
import type { MangaBookmarkRepository } from "./manga-bookmarks";
import type { MangaBookmark, MangaDiscoveryTitle } from "../shared/manga";
import type { StorageDriver } from "@vestra/storage";
import type {
  MangaBook,
  MangaChapter,
  MangaPage,
  MangaRecent,
  ReadingProgress,
} from "../shared/manga";
type Call = (method: string, args: unknown[]) => Promise<unknown>;
export interface MangaArtwork {
  url: string;
  headers: Record<string, string>;
}
export interface ReadingProgressRepository {
  setCover?(book: string, cover: MangaArtwork): Promise<void>;
  read(book: string): Promise<ReadingProgress | null>;
  save(
    book: string,
    chapter: string,
    page: number,
    pageCount: number,
    title: string,
    cover?: MangaArtwork,
  ): Promise<void>;
  recent(): Promise<
    Omit<MangaRecent, "entries"> & {
      entries: {
        book: MangaBook;
        progress: ReadingProgress;
        artwork?: MangaArtwork;
      }[];
    }
  >;
  import(book: string, progress: ReadingProgress): Promise<ReadingProgress>;
}
const bookSchema = z.object({
  id: z.string().min(1).max(4096),
  title: z.string().min(1).max(4096),
});
const searchBookSchema = bookSchema.extend({
  image: z.string().max(4096).nullish(),
  imageHeaders: z.record(z.string(), z.string()).nullish(),
});
const chapterSchema = z.object({
  id: z.string().min(1).max(4096),
  title: z.string(),
  chapter: z.string(),
  index: z.number().int().nonnegative(),
  language: z.string().optional(),
  scanlator: z.string().optional(),
});
const pageSchema = z.object({
  url: z
    .string()
    .url()
    .refine((v) => new URL(v).protocol === "https:"),
  index: z.number().int().nonnegative(),
  headers: z.record(z.string(), z.string()).nullish(),
});
const progressSchema = z.object({
  chapterId: z.string().min(1).max(4096),
  page: z.number().int().min(0).max(1999),
  updatedAt: z.string().datetime(),
});
export class MangaService {
  private providers = new Map<
    string,
    {
      name: string;
      call: Call;
      image: (r: unknown) => Promise<unknown>;
      progress: ReadingProgressRepository;
    }
  >();
  private books = new Map<string, MangaBook>();
  private artwork = new Map<string, MangaArtwork>();
  private covers = new Map<string, MangaArtwork & { providerId: string }>();
  private chaptersByBook = new Map<string, MangaChapter[]>();
  private handles = new Map<
    string,
    { providerId: string; url: string; headers: Record<string, string> }
  >();
  private counts = new Map<string, number>();
  private writes: Promise<void> = Promise.resolve();
  private coverLookups = new Map<string, Promise<MangaBook>>();
  private coverImages = new Map<string, Promise<string>>();
  private warmQueue = new Set<string>();
  private warming = 0;
  private catalogueImages: {
    image: (request: unknown) => Promise<unknown>;
  } | null = null;
  private catalogueCovers = new Map<number, string>();
  private catalogueTitles = new Map<number, string>();
  private bookmarksRepository: MangaBookmarkRepository | null = null;
  constructor(
    private readonly driver: StorageDriver,
    private coverCache?: MangaCoverCache,
  ) {}
  registerBookmarks(repository: MangaBookmarkRepository) {
    this.bookmarksRepository = repository;
  }
  registerCatalogueTitle(title: MangaDiscoveryTitle) {
    this.catalogueTitles.delete(title.id);
    this.catalogueTitles.set(title.id, title.title);
    if (this.catalogueTitles.size > 1000)
      this.catalogueTitles.delete(this.catalogueTitles.keys().next().value!);
  }
  knownBook(provider: string, id: string): MangaBook {
    this.provider(provider);
    return this.books.get(this.book(provider, id))!;
  }
  async resolveBook(
    provider: string,
    id: string,
    title?: string,
  ): Promise<MangaBook> {
    this.provider(provider);
    const key = this.key(provider, id);
    if (this.books.has(key)) return this.books.get(key)!;
    await this.bookmarks();
    if (this.books.has(key)) return this.books.get(key)!;
    await this.recent(provider);
    if (this.books.has(key)) return this.books.get(key)!;
    if (title) {
      const rows = await this.search(provider, title);
      const match = rows.find((row) => row.id === id);
      if (match) return match;
    }
    throw new Error(
      "This title is no longer available in this source. Search for it again.",
    );
  }
  async bookmarks(): Promise<MangaBookmark[]> {
    if (!this.bookmarksRepository) return [];
    await this.writes;
    const rows = await this.bookmarksRepository.list();
    const result = rows.map((row) => {
      let book: MangaBook;
      if (row.kind === "catalogue") {
        const id = Number(row.id);
        this.catalogueTitles.set(id, row.title);
        const cover = row.cover
          ? this.catalogueCover(id, row.cover.url)
          : undefined;
        book = { id: row.id, title: row.title, ...(cover ? { cover } : {}) };
      } else
        book = this.remember(
          row.source,
          { id: row.id, title: row.title },
          row.cover ?? undefined,
        );
      return { kind: row.kind, source: row.source, book, savedAt: row.savedAt };
    });
    if (this.coverCache) this.warm(result.map((row) => row.book));
    return result;
  }
  bookmark(
    kind: "source" | "catalogue",
    source: string,
    id: string,
    saved: boolean,
  ): Promise<void> {
    const repository = this.bookmarksRepository;
    if (!repository)
      return Promise.reject(new Error("Manga bookmarks are unavailable."));
    let title = "",
      cover: MangaArtwork | undefined;
    if (saved) {
      if (kind === "source") {
        const book = this.knownBook(source, id);
        title = book.title;
        cover = this.artwork.get(this.key(source, id));
      } else {
        if (source !== "anilist" || !this.catalogueTitles.has(Number(id)))
          return Promise.reject(
            new Error("Open this catalogue title before bookmarking it."),
          );
        title = this.catalogueTitles.get(Number(id))!;
        const handle = this.catalogueCovers.get(Number(id));
        const image = handle ? this.covers.get(handle) : undefined;
        if (image) cover = { url: image.url, headers: image.headers };
      }
    }
    const write = this.writes.then(() =>
      repository.set({ kind, source, id, title, cover }, saved),
    );
    this.writes = write.catch(() => undefined);
    return write;
  }
  registerCatalogueImages(image: (request: unknown) => Promise<unknown>) {
    this.catalogueImages = { image };
  }
  catalogueCover(id: number, url: string): string {
    const previous = this.catalogueCovers.get(id);
    if (previous && this.covers.get(previous)?.url === url) return previous;
    if (previous) this.covers.delete(previous);
    this.catalogueCovers.delete(id);
    if (this.catalogueCovers.size >= 1000) {
      const oldest = this.catalogueCovers.keys().next().value!;
      this.covers.delete(this.catalogueCovers.get(oldest)!);
      this.catalogueCovers.delete(oldest);
    }
    const handle = randomUUID();
    this.catalogueCovers.set(id, handle);
    this.covers.set(handle, {
      providerId: "catalogue:anilist",
      url,
      headers: {},
    });
    return handle;
  }
  preloadArtwork(handles: string[]) {
    this.warm(handles.map((cover) => ({ id: cover, title: "", cover })));
  }
  async refreshCatalogueCover(id: number): Promise<string> {
    const handle = this.catalogueCovers.get(id),
      row = handle ? this.covers.get(handle) : null;
    if (!handle || !row)
      throw new Error("Reopen the catalogue to reload this cover.");
    await this.coverCache
      ?.invalidate(row.providerId, row)
      .catch(() => undefined);
    this.covers.delete(handle);
    this.catalogueCovers.delete(id);
    const fresh = this.catalogueCover(id, row.url);
    this.preloadArtwork([fresh]);
    return fresh;
  }
  private warm(books: MangaBook[]) {
    for (const book of books.slice(0, 8))
      if (book.cover && this.warmQueue.size < 24)
        this.warmQueue.add(book.cover);
    while (this.warming < 2 && this.warmQueue.size) {
      const handle = this.warmQueue.values().next().value!;
      this.warmQueue.delete(handle);
      this.warming++;
      void this.image(handle)
        .catch(() => undefined)
        .finally(() => {
          this.warming--;
          this.warm([]);
        });
    }
  }
  register(
    id: string,
    name: string,
    call: Call,
    image: (r: unknown) => Promise<unknown>,
    progress: ReadingProgressRepository,
  ) {
    this.providers.set(id, { name, call, image, progress });
  }
  unregister(id: string) {
    this.providers.delete(id);
    for (const [k, v] of this.handles)
      if (v.providerId === id) this.handles.delete(k);
    for (const [k, v] of this.covers)
      if (v.providerId === id) this.covers.delete(k);
  }
  list() {
    return [...this.providers].map(([id, p]) => ({ id, name: p.name }));
  }
  private key(p: string, b: string) {
    return JSON.stringify([p, b]);
  }
  private provider(id: string) {
    const p = this.providers.get(id);
    if (!p) throw new Error("Manga source is unavailable.");
    return p;
  }
  private book(p: string, b: string) {
    const key = this.key(p, b);
    if (!this.books.has(key)) throw new Error("Search for this manga again.");
    return key;
  }
  private remember(
    provider: string,
    book: MangaBook,
    artwork?: MangaArtwork,
  ): MangaBook {
    const key = this.key(provider, book.id);
    const previous = this.books.get(key);
    const saved = artwork ?? this.artwork.get(key);
    let cover = previous?.cover;
    if (
      saved &&
      (!cover ||
        !this.covers.has(cover) ||
        JSON.stringify(saved) !== JSON.stringify(this.artwork.get(key)))
    ) {
      if (cover) this.covers.delete(cover);
      cover = randomUUID();
      this.covers.set(cover, { ...saved, providerId: provider });
      this.artwork.set(key, saved);
    }
    this.books.delete(key);
    if (this.books.size >= 2048) {
      const oldest = this.books.keys().next().value!;
      const old = this.books.get(oldest)!;
      if (old.cover) this.covers.delete(old.cover);
      this.artwork.delete(oldest);
      this.books.delete(oldest);
    }
    const managed = {
      id: book.id,
      title: book.title,
      ...(cover ? { cover } : {}),
    };
    this.books.set(key, managed);
    return managed;
  }
  async recent(id: string): Promise<MangaRecent> {
    await this.writes;
    const result = await this.provider(id).progress.recent();
    const managed = {
      ...result,
      entries: result.entries.map((entry) => ({
        book: this.remember(id, bookSchema.parse(entry.book), entry.artwork),
        progress: entry.progress,
      })),
    };
    if (this.coverCache) this.warm(managed.entries.map((entry) => entry.book));
    return managed;
  }
  async search(id: string, query: string): Promise<MangaBook[]> {
    const rows = z
      .array(searchBookSchema)
      .max(2000)
      .parse(await this.provider(id).call("search", [{ query, year: 0 }]));
    // Leave room for recent titles and another small result set in the grant cache.
    const managed = rows.slice(0, 400).map((row) => {
      let artwork: MangaArtwork | undefined;
      if (row.image) {
        try {
          const uri = new URL(row.image);
          if (uri.protocol === "https:" && !uri.username && !uri.password)
            artwork = { url: row.image, headers: row.imageHeaders ?? {} };
        } catch {
          /* A missing/broken cover must not hide an otherwise usable title. */
        }
      }
      return this.remember(id, row, artwork);
    });
    if (this.coverCache) this.warm(managed);
    return managed;
  }
  async chapters(id: string, book: string): Promise<MangaChapter[]> {
    const key = this.book(id, book);
    const rows = z
      .array(chapterSchema)
      .max(10000)
      .parse(await this.provider(id).call("findChapters", [book]));
    if (this.chaptersByBook.size >= 20 && !this.chaptersByBook.has(key))
      this.chaptersByBook.delete(this.chaptersByBook.keys().next().value!);
    this.chaptersByBook.set(key, rows);
    return rows;
  }
  cover(id: string, book: string, refresh = false): Promise<MangaBook> {
    const key = this.book(id, book);
    const known = this.books.get(key)!;
    const provider = this.provider(id);
    if (!refresh && known.cover && this.covers.has(known.cover))
      return Promise.resolve(known);
    const pending = this.coverLookups.get(key);
    if (pending) return pending;
    if (this.coverLookups.size >= 24)
      return Promise.reject(
        new Error("Cover lookups are busy. Retry shortly."),
      );
    const lookup = (async () => {
      const rows = z
        .array(searchBookSchema)
        .max(2000)
        .parse(
          await provider.call("search", [{ query: known.title, year: 0 }]),
        );
      if (this.providers.get(id) !== provider)
        throw new Error("Manga source changed. Reopen the library.");
      // Match the provider's own exact ID; a similar title is not evidence of identity.
      const row = rows.find((result) => result.id === book);
      if (!row?.image) return known;
      const uri = new URL(row.image);
      if (uri.protocol !== "https:" || uri.username || uri.password)
        throw new Error("Source returned an invalid cover URL.");
      const artwork = { url: row.image, headers: row.imageHeaders ?? {} };
      if (refresh)
        await this.coverCache?.invalidate(id, artwork).catch(() => undefined);
      if (refresh && known.cover) this.covers.delete(known.cover);
      const managed = this.remember(id, known, artwork);
      if (this.coverCache) this.warm([managed]);
      // Artwork enrichment preserves the reading timestamp/page and creates no history entry.
      if (provider.progress.setCover) {
        const write = this.writes.then(() =>
          provider.progress.setCover!(book, artwork),
        );
        this.writes = write.catch(() => undefined);
        await write.catch((error: unknown) =>
          console.warn(
            "[manga] Cover metadata could not be saved:",
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
      if (this.providers.get(id) !== provider)
        throw new Error("Manga source changed. Reopen the library.");
      return managed;
    })();
    this.coverLookups.set(key, lookup);
    void lookup
      .finally(() => {
        if (this.coverLookups.get(key) === lookup)
          this.coverLookups.delete(key);
      })
      .catch(() => undefined);
    return lookup;
  }
  async pages(id: string, book: string, chapter: string): Promise<MangaPage[]> {
    const key = this.book(id, book);
    if (!this.chaptersByBook.get(key)?.some((c) => c.id === chapter))
      throw new Error("Load the chapter list first.");
    const rows = z
      .array(pageSchema)
      .max(2000)
      .parse(await this.provider(id).call("findChapterPages", [chapter]));
    const sorted = [...rows].sort((a, b) => a.index - b.index);
    this.counts.set(JSON.stringify([id, book, chapter]), sorted.length);
    if (this.counts.size > 100)
      this.counts.delete(this.counts.keys().next().value!);
    return sorted.map((row) => {
      const handle = randomUUID();
      if (this.handles.size >= 2000)
        this.handles.delete(this.handles.keys().next().value!);
      this.handles.set(handle, {
        providerId: id,
        url: row.url,
        headers: row.headers ?? {},
      });
      return { handle, index: row.index };
    });
  }
  async image(handle: string): Promise<string> {
    const r = this.handles.get(handle) ?? this.covers.get(handle);
    if (!r) throw new Error("Page expired. Reopen the chapter.");
    const catalogue = r.providerId === "catalogue:anilist";
    const provider = catalogue
      ? this.catalogueImages
      : this.provider(r.providerId);
    if (!provider) throw new Error("Catalogue images are unavailable.");
    const valid = () =>
      (this.handles.get(handle) ?? this.covers.get(handle)) === r &&
      (catalogue ? this.catalogueImages : this.providers.get(r.providerId)) ===
        provider;
    const cover = this.covers.get(handle) === r;
    if (cover) {
      const pending = this.coverImages.get(handle);
      if (pending) return pending;
    }
    const fetch = async () => {
      if (cover) {
        const cached = await this.coverCache
          ?.get(r.providerId, r)
          .catch(() => null);
        if (!valid())
          throw new Error("Manga source changed. Reopen the library.");
        if (cached) return cached;
      }
      const value = z
        .object({
          mimeType: z.enum([
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif",
            "image/avif",
          ]),
          data: z
            .string()
            .max(2796204)
            .regex(/^[A-Za-z0-9+/]*={0,2}$/),
        })
        .parse(
          await provider.image({
            url: r.url,
            method: "GET",
            headers: r.headers,
          }),
        );
      if (!valid())
        throw new Error("Manga source changed. Reopen the chapter.");
      const data = `data:${value.mimeType};base64,${value.data}`;
      if (cover)
        await this.coverCache
          ?.put(r.providerId, r, data)
          .catch(() => undefined);
      if (!valid())
        throw new Error("Manga source changed. Reopen the library.");
      return data;
    };
    if (!cover) return fetch();
    const result = fetch();
    this.coverImages.set(handle, result);
    void result
      .finally(() => {
        if (this.coverImages.get(handle) === result)
          this.coverImages.delete(handle);
      })
      .catch(() => undefined);
    return result;
  }
  private progressKey(p: string, b: string) {
    return (
      "manga-progress-" +
      createHash("sha256").update(this.key(p, b)).digest("hex").slice(0, 40)
    );
  }
  async progress(p: string, b: string): Promise<ReadingProgress | null> {
    this.book(p, b);
    await this.writes;
    const repository = this.provider(p).progress;
    const current = await repository.read(b);
    if (current !== null) return current;
    // Keep the legacy file as a recovery copy. Import never overwrites C# state.
    const raw = await this.driver.read(this.progressKey(p, b));
    return raw === null
      ? null
      : repository.import(b, progressSchema.parse(raw));
  }
  save(p: string, b: string, chapterId: string, page: number): Promise<void> {
    this.book(p, b);
    const count = this.counts.get(JSON.stringify([p, b, chapterId]));
    if (
      count === undefined ||
      !Number.isInteger(page) ||
      page < 0 ||
      page >= count
    )
      return Promise.reject(new Error("Invalid reading position."));
    const repository = this.provider(p).progress;
    const title = this.books.get(this.key(p, b))!.title;
    const cover = this.artwork.get(this.key(p, b));
    const result = this.writes.then(() =>
      repository.save(b, chapterId, page, count, title, cover),
    );
    this.writes = result.catch(() => undefined);
    return result;
  }
}
