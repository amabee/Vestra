import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { StorageDriver } from "@vestra/storage";
import type {
  MangaBook,
  MangaChapter,
  MangaPage,
  MangaRecent,
  ReadingProgress,
} from "../shared/manga";
type Call = (method: string, args: unknown[]) => Promise<unknown>;
export interface ReadingProgressRepository {
  read(book: string): Promise<ReadingProgress | null>;
  save(
    book: string,
    chapter: string,
    page: number,
    pageCount: number,
    title: string,
  ): Promise<void>;
  recent(): Promise<MangaRecent>;
  import(book: string, progress: ReadingProgress): Promise<ReadingProgress>;
}
const bookSchema = z.object({
  id: z.string().min(1).max(4096),
  title: z.string().min(1).max(4096),
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
  private chaptersByBook = new Map<string, MangaChapter[]>();
  private handles = new Map<
    string,
    { providerId: string; url: string; headers: Record<string, string> }
  >();
  private counts = new Map<string, number>();
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly driver: StorageDriver) {}
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
  private remember(provider: string, book: MangaBook) {
    const key = this.key(provider, book.id);
    this.books.delete(key);
    if (this.books.size >= 500)
      this.books.delete(this.books.keys().next().value!);
    this.books.set(key, book);
  }
  async recent(id: string): Promise<MangaRecent> {
    await this.writes;
    const result = await this.provider(id).progress.recent();
    for (const entry of result.entries)
      this.remember(id, bookSchema.parse(entry.book));
    return result;
  }
  async search(id: string, query: string): Promise<MangaBook[]> {
    const rows = z
      .array(bookSchema)
      .max(2000)
      .parse(await this.provider(id).call("search", [{ query, year: 0 }]));
    for (const row of rows) {
      this.remember(id, row);
    }
    return rows;
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
    const r = this.handles.get(handle);
    if (!r) throw new Error("Page expired. Reopen the chapter.");
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
        await this.provider(r.providerId).image({
          url: r.url,
          method: "GET",
          headers: r.headers,
        }),
      );
    return `data:${value.mimeType};base64,${value.data}`;
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
    const result = this.writes.then(() =>
      repository.save(b, chapterId, page, count, title),
    );
    this.writes = result.catch(() => undefined);
    return result;
  }
}
