import { z } from "zod";
import type { StorageDriver } from "@vestra/storage";
import type { MangaInformation } from "../shared/manga";
import { fetchMangaGraphQL } from "./manga-discovery";

const rowSchema = z.object({
  id: z.number().int().positive(),
  title: z.object({
    english: z.string().nullish(),
    romaji: z.string().nullish(),
    native: z.string().nullish(),
  }),
  description: z.string().max(100_000).nullish(),
  coverImage: z
    .object({
      extraLarge: z.string().url().nullish(),
      large: z.string().url().nullish(),
    })
    .nullish(),
  genres: z.array(z.string()).max(30),
  countryOfOrigin: z.string().nullable(),
  status: z.string().nullable(),
  averageScore: z.number().min(0).max(100).nullable(),
  chapters: z.number().int().nonnegative().nullable(),
  volumes: z.number().int().nonnegative().nullable(),
  startDate: z.object({ year: z.number().nullable() }).nullish(),
});
const fields = `id title{english romaji native} description(asHtml:false) coverImage{extraLarge large} genres countryOfOrigin status averageScore chapters volumes startDate{year}`;
const byId = `query MangaInfo($id:Int!){Media(id:$id,type:MANGA,isAdult:false){${fields}}}`;
const byTitle = `query MangaSourceInfo($search:String!){Page(perPage:10){media(type:MANGA,isAdult:false,search:$search){${fields}}}}`;
const normalise = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
const text = (value: string) =>
  value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
type Row = z.infer<typeof rowSchema>;
export class MangaDetails {
  private rows = new Map<number, { expires: number; row: Row }>();
  private matches = new Map<string, number | null>();
  private loading: Promise<void> | null = null;
  private pending = new Map<string, Promise<MangaInformation | null>>();
  private writes = Promise.resolve();
  constructor(
    private driver: StorageDriver,
    private cover: (id: number, url: string) => string,
    private request = fetchMangaGraphQL,
  ) {}
  private load() {
    return (this.loading ??= (async () => {
      try {
        const data = z
          .array(z.object({ expires: z.number(), row: rowSchema }))
          .max(64)
          .parse(await this.driver.read("manga-details-v1"));
        for (const item of data) this.rows.set(item.row.id, item);
      } catch {}
    })());
  }
  private dto(row: Row): MangaInformation {
    const titles = [
      ...new Set(
        [row.title.english, row.title.romaji, row.title.native].filter(
          (value): value is string => !!value,
        ),
      ),
    ];
    const url = row.coverImage?.extraLarge || row.coverImage?.large;
    let cover: string | undefined;
    if (url) {
      const uri = new URL(url);
      if (uri.protocol === "https:" && !uri.username && !uri.password)
        cover = this.cover(row.id, url);
    }
    return {
      id: row.id,
      title: titles[0] || "Untitled",
      titles,
      description: row.description ? text(row.description) : null,
      cover,
      genres: row.genres,
      origin: row.countryOfOrigin,
      status: row.status,
      score: row.averageScore,
      chapters: row.chapters,
      volumes: row.volumes,
      year: row.startDate?.year ?? null,
    };
  }
  private async remember(row: Row) {
    this.rows.delete(row.id);
    this.rows.set(row.id, { row, expires: Date.now() + 24 * 60 * 60_000 });
    while (this.rows.size > 64)
      this.rows.delete(this.rows.keys().next().value!);
    const snapshot = [...this.rows.values()];
    this.writes = this.writes
      .then(() => this.driver.write("manga-details-v1", snapshot))
      .catch(() => undefined);
    await this.writes;
    return this.dto(row);
  }
  async get(id: number): Promise<MangaInformation | null> {
    z.number().int().positive().parse(id);
    await this.load();
    const cached = this.rows.get(id);
    if (cached && cached.expires > Date.now()) return this.dto(cached.row);
    return this.run(`id:${id}`, async () => {
      const data = z
        .object({ Media: rowSchema.nullable() })
        .parse(await this.request(byId, { id }));
      if (data.Media && data.Media.id !== id)
        throw new Error("Catalogue returned a different manga.");
      return data.Media ? this.remember(data.Media) : null;
    });
  }
  async source(title: string): Promise<MangaInformation | null> {
    await this.load();
    const exact = normalise(title);
    if (this.matches.has(exact)) {
      const id = this.matches.get(exact);
      return id ? this.get(id) : null;
    }
    return this.run(`title:${exact}`, async () => {
      const data = z
        .object({ Page: z.object({ media: z.array(rowSchema).max(10) }) })
        .parse(await this.request(byTitle, { search: title.slice(0, 500) }));
      const matches = data.Page.media.filter((row) =>
        [row.title.english, row.title.romaji, row.title.native].some(
          (name) => name && normalise(name) === exact,
        ),
      );
      const row = matches.length === 1 ? matches[0] : undefined;
      this.matches.set(exact, row?.id ?? null);
      if (this.matches.size > 128)
        this.matches.delete(this.matches.keys().next().value!);
      return row ? this.remember(row) : null;
    });
  }
  private run(key: string, work: () => Promise<MangaInformation | null>) {
    const prior = this.pending.get(key);
    if (prior) return prior;
    if (this.pending.size >= 4)
      return Promise.reject(
        new Error("Manga information is busy. Try again shortly."),
      );
    const result = work();
    this.pending.set(key, result);
    void result.finally(() => this.pending.delete(key)).catch(() => undefined);
    return result;
  }
}
