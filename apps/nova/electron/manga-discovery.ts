import { createHash } from "node:crypto";
import { z } from "zod";
import type { StorageDriver } from "@vestra/storage";
import type { MangaDiscoveryPage } from "../shared/manga";

export const discoveryQuery = z.object({
  sort: z.enum(["popular", "trending", "score", "newest"]).default("popular"),
  origin: z.enum(["all", "JP", "KR", "CN"]).default("all"),
  genre: z.string().trim().max(50).default(""),
  status: z.enum(["all", "RELEASING", "FINISHED"]).default("all"),
  page: z.number().int().min(1).max(100).default(1),
});
const payload = z.object({
  GenreCollection: z.array(z.string().max(50)).max(100),
  Page: z.object({
    pageInfo: z.object({ hasNextPage: z.boolean() }),
    media: z
      .array(
        z.object({
          id: z.number().int().positive(),
          title: z.object({
            english: z.string().max(500).nullish(),
            romaji: z.string().max(500).nullish(),
            native: z.string().max(500).nullish(),
          }),
          coverImage: z
            .object({
              extraLarge: z.string().max(4096).nullish(),
              large: z.string().max(4096).nullish(),
              medium: z.string().max(4096).nullish(),
            })
            .nullish(),
          genres: z.array(z.string().max(50)).max(30),
          countryOfOrigin: z.string().max(3).nullable(),
          status: z.string().max(40).nullable(),
          averageScore: z.number().min(0).max(100).nullable(),
        }),
      )
      .max(24),
  }),
});
type Data = z.infer<typeof payload>;
type CacheEntry = { key: string; expires: number; data: Data };
export const mangaCatalogueQuery = `query MangaDiscovery($page:Int,$sort:[MediaSort],$country:CountryCode,$genres:[String],$status:MediaStatus) {
  GenreCollection
  Page(page:$page,perPage:24) {
    pageInfo { hasNextPage }
    media(type:MANGA,format_in:[MANGA,ONE_SHOT],isAdult:false,sort:$sort,countryOfOrigin:$country,genre_in:$genres,status:$status) {
      id title { english romaji native } coverImage { extraLarge large medium }
      genres countryOfOrigin status averageScore
    }
  }
}`;
class RateLimited extends Error {
  constructor(readonly seconds: number) {
    super("Discovery is temporarily rate limited. Try again shortly.");
  }
}
export async function fetchMangaGraphQL(
  query: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 429)
    throw new RateLimited(
      Math.min(
        120,
        Math.max(10, Number(response.headers.get("Retry-After")) || 60),
      ),
    );
  if (!response.ok)
    throw new Error(`AniList catalogue returned HTTP ${response.status}.`);
  const text = await response.text();
  if (text.length > 2_097_152)
    throw new Error("Catalogue response exceeded its size limit.");
  const json = JSON.parse(text);
  if (json.errors?.length)
    throw new Error("AniList could not process this catalogue request.");
  return json.data;
}
export const fetchMangaCatalogue = (variables: Record<string, unknown>) =>
  fetchMangaGraphQL(mangaCatalogueQuery, variables);

/** Metadata catalogue only. Selecting a title searches the user's installed source. */
export class MangaDiscovery {
  private cache = new Map<string, CacheEntry>();
  private pending = new Map<string, Promise<MangaDiscoveryPage>>();
  private loading: Promise<void> | null = null;
  private writes = Promise.resolve();
  private retryAt = 0;
  constructor(
    private driver: StorageDriver,
    private cover: (id: number, url: string) => string,
    private request = fetchMangaCatalogue,
    private now = Date.now,
  ) {}
  private load() {
    return (this.loading ??= (async () => {
      try {
        const stored = z
          .object({
            entries: z
              .array(
                z.object({
                  key: z.string().regex(/^[a-f0-9]{64}$/),
                  expires: z.number(),
                  data: payload,
                }),
              )
              .max(32),
          })
          .parse(await this.driver.read("manga-discovery-v2"));
        for (const entry of stored.entries) this.cache.set(entry.key, entry);
      } catch {
        /* Metadata cache is optional. */
      }
    })());
  }
  private page(
    entry: CacheEntry,
    page: number,
    stale = false,
  ): MangaDiscoveryPage {
    return {
      page,
      stale,
      hasNextPage: entry.data.Page.pageInfo.hasNextPage,
      genres: entry.data.GenreCollection,
      items: entry.data.Page.media.map((row) => {
        const title =
          row.title.english ||
          row.title.romaji ||
          row.title.native ||
          "Untitled";
        const url =
          row.coverImage?.extraLarge ||
          row.coverImage?.large ||
          row.coverImage?.medium;
        let cover: string | undefined;
        if (url) {
          try {
            const uri = new URL(url);
            if (uri.protocol === "https:" && !uri.username && !uri.password)
              cover = this.cover(row.id, url);
          } catch {
            /* Keep a usable title when art is missing. */
          }
        }
        return {
          id: row.id,
          title,
          cover,
          genres: row.genres,
          origin: row.countryOfOrigin,
          status: row.status,
          score: row.averageScore,
        };
      }),
    };
  }
  async browse(raw: unknown): Promise<MangaDiscoveryPage> {
    const query = discoveryQuery.parse(raw);
    const key = createHash("sha256")
      .update(JSON.stringify(query))
      .digest("hex");
    await this.load();
    const stored = this.cache.get(key);
    if (stored && stored.expires > this.now()) {
      this.cache.delete(key);
      this.cache.set(key, stored);
      return this.page(stored, query.page);
    }
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.pending.size >= 4)
      throw new Error("Catalogue is busy. Try again shortly.");
    const request = (async () => {
      try {
        if (this.now() < this.retryAt)
          throw new Error(
            "Discovery is temporarily rate limited. Try again shortly.",
          );
        const sort = {
          popular: ["POPULARITY_DESC"],
          trending: ["TRENDING_DESC", "POPULARITY_DESC"],
          score: ["SCORE_DESC", "POPULARITY_DESC"],
          newest: ["START_DATE_DESC", "POPULARITY_DESC"],
        }[query.sort];
        const data = payload.parse(
          await this.request({
            page: query.page,
            sort,
            ...(query.origin !== "all" ? { country: query.origin } : {}),
            ...(query.genre ? { genres: [query.genre] } : {}),
            ...(query.status !== "all" ? { status: query.status } : {}),
          }),
        );
        const entry = {
          key,
          data,
          expires: this.now() + (query.sort === "trending" ? 10 : 60) * 60_000,
        };
        this.cache.delete(key);
        this.cache.set(key, entry);
        while (this.cache.size > 32)
          this.cache.delete(this.cache.keys().next().value!);
        const snapshot = { entries: [...this.cache.values()] };
        this.writes = this.writes
          .then(() => this.driver.write("manga-discovery-v2", snapshot))
          .catch(() => undefined);
        await this.writes;
        return this.page(entry, query.page);
      } catch (error) {
        if (error instanceof RateLimited)
          this.retryAt = this.now() + error.seconds * 1000;
        if (stored && stored.expires > this.now() - 7 * 24 * 60 * 60_000)
          return this.page(stored, query.page, true);
        throw error;
      }
    })();
    this.pending.set(key, request);
    void request.finally(() => this.pending.delete(key)).catch(() => undefined);
    return request;
  }
}
