import { z } from "zod";
import {
  discoveryCategorySchema,
  type StreamSourceRegistry,
  type StreamSourceProvider,
  type Anime,
} from "@vestra/extension-host";
import { mediaItemSchema } from "@vestra/types";
import type { AnimeService } from "./anime-service";
import type { AnimeDiscoveryPage } from "../shared/anime";
import { fetchCatalogueGraphQL } from "./catalogue-graphql";
import { TtlCache } from "./ttl-cache";

export const animeDiscoveryQuery = z.object({
  category: discoveryCategorySchema.default("suggested"),
  page: z.number().int().min(1).max(100).default(1),
});
const cataloguePayload = z.object({
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
            })
            .nullish(),
          seasonYear: z.number().int().nullish(),
        }),
      )
      .max(24),
  }),
});
export const animeDiscoveryGraphQL = `query AnimeDiscovery($page:Int,$sort:[MediaSort],$status:MediaStatus,$exclude:MediaStatus) {
  Page(page:$page,perPage:24) { pageInfo { hasNextPage }
    media(type:ANIME,isAdult:false,sort:$sort,status:$status,status_not:$exclude) {
      id title { english romaji native } coverImage { extraLarge large } seasonYear
    }
  }
}`;

/** Feeds belong to registered sources; catalogue fallback is explicitly labelled. */
export class AnimeDiscovery {
  private feeds = new WeakMap<
    StreamSourceProvider,
    TtlCache<{ items: Anime[]; hasMore: boolean }>
  >();
  private catalogue = new TtlCache<z.infer<typeof cataloguePayload>>(
    5 * 60_000,
    30,
  );
  constructor(
    private registry: StreamSourceRegistry,
    private titles: AnimeService,
    private fetchCatalogue = fetchCatalogueGraphQL,
  ) {}
  async browse(id: string, raw: unknown): Promise<AnimeDiscoveryPage> {
    const query = animeDiscoveryQuery.parse(raw);
    const source = this.registry
      .supporting("anime")
      .find((row) => row.id === id);
    if (!source)
      throw new Error("This anime source is disabled or unavailable.");
    const current = () => {
      if (this.registry.get(id) !== source || !this.registry.isEnabled(id))
        throw new Error("This source changed. Reload its discovery page.");
    };
    const categories =
      source.browse && source.browseCategories?.length
        ? [...source.browseCategories]
        : null;
    if (categories) {
      if (!categories.includes(query.category))
        throw new Error(
          "This source does not provide that discovery category.",
        );
      let cache = this.feeds.get(source);
      if (!cache) {
        cache = new TtlCache(2 * 60_000, 25);
        this.feeds.set(source, cache);
      }
      const page = await cache.run(JSON.stringify(query), async () => {
        const result = await source.browse!(
          query.category,
          { page: query.page, limit: 24 },
          { signal: AbortSignal.timeout(15_000), timeoutMs: 15_000 },
        );
        current();
        return result;
      });
      current();
      return {
        mode: "source",
        categories,
        category: query.category,
        page: query.page,
        hasMore: page.hasMore,
        items: this.titles.remember(source, page.items),
      };
    }
    const variables: Record<string, unknown> = {
      page: query.page,
      sort: ["TRENDING_DESC"],
    };
    if (query.category === "ongoing") variables.status = "RELEASING";
    if (query.category === "popular") variables.sort = ["POPULARITY_DESC"];
    if (query.category === "latest") {
      variables.sort = ["START_DATE_DESC"];
      variables.exclude = "NOT_YET_RELEASED";
    }
    if (query.category === "upcoming") {
      variables.status = "NOT_YET_RELEASED";
      variables.sort = ["POPULARITY_DESC"];
    }
    const data = await this.catalogue.run(JSON.stringify(query), async () =>
      cataloguePayload.parse(
        await this.fetchCatalogue(animeDiscoveryGraphQL, variables),
      ),
    );
    current();
    return {
      mode: "catalogue",
      categories: discoveryCategorySchema.options,
      category: query.category,
      page: query.page,
      hasMore: data.Page.pageInfo.hasNextPage,
      items: data.Page.media.map((row) =>
        mediaItemSchema.parse({
          source: "anilist",
          sourceId: String(row.id),
          kind: "anime",
          title:
            row.title.english ||
            row.title.romaji ||
            row.title.native ||
            `AniList ${row.id}`,
          year: row.seasonYear ?? null,
          images: {
            poster: row.coverImage?.extraLarge ?? row.coverImage?.large ?? null,
          },
          rating: {},
          isSeries: true,
        }),
      ),
    };
  }
}
