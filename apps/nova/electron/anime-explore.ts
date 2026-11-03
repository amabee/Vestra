import { z } from "zod";
import { normaliseAnime } from "@vestra/api/anilist";
import { mediaItemSchema } from "@vestra/types";
import type {
  AnimeCatalogueTitle,
  AnimeExplorePage,
} from "../shared/anime-hub";
import { fetchCatalogueGraphQL } from "./catalogue-graphql";
import { TtlCache } from "./ttl-cache";

const statusSchema = z.enum([
  "RELEASING",
  "NOT_YET_RELEASED",
  "FINISHED",
  "HIATUS",
  "CANCELLED",
]);
const formatSchema = z.enum([
  "TV",
  "TV_SHORT",
  "MOVIE",
  "SPECIAL",
  "OVA",
  "ONA",
  "MUSIC",
]);
const seasonSchema = z.enum(["WINTER", "SPRING", "SUMMER", "FALL"]);
export const animeExploreQuery = z.object({
  genre: z.string().trim().max(50).default(""),
  year: z.number().int().min(1900).max(2100).nullable().default(null),
  status: statusSchema.or(z.literal("")).default(""),
  format: formatSchema.or(z.literal("")).default(""),
  season: seasonSchema.or(z.literal("")).default(""),
  search: z.string().trim().max(200).default(""),
});
const mediaSchema = z.object({
  isAdult: z.boolean().nullish(),
  id: z.number().int().positive(),
  title: z.object({
    english: z.string().max(500).nullish(),
    romaji: z.string().max(500).nullish(),
    native: z.string().max(500).nullish(),
  }),
  description: z.string().max(30000).nullish(),
  coverImage: z
    .object({
      extraLarge: z.string().max(4096).nullish(),
      large: z.string().max(4096).nullish(),
      medium: z.string().max(4096).nullish(),
      color: z.string().max(30).nullish(),
    })
    .nullish(),
  bannerImage: z.string().max(4096).nullish(),
  averageScore: z.number().min(0).max(100).nullish(),
  popularity: z.number().nonnegative().nullish(),
  genres: z.array(z.string().max(50)).max(30).default([]),
  episodes: z.number().int().nonnegative().nullish(),
  duration: z.number().nonnegative().nullish(),
  status: statusSchema.nullish(),
  format: formatSchema.nullish(),
  season: seasonSchema.nullish(),
  seasonYear: z.number().int().nullish(),
  siteUrl: z.string().max(4096).nullish(),
  nextAiringEpisode: z
    .object({
      episode: z.number().int().nonnegative(),
      airingAt: z.number().int(),
    })
    .nullish(),
});
const pageSchema = z.object({ media: z.array(mediaSchema).max(20) });
const responseSchema = z.object({
  GenreCollection: z.array(z.string().max(50)).max(100),
  trending: pageSchema,
  topSeason: pageSchema,
  upcoming: pageSchema.optional(),
  movies: pageSchema.optional(),
});
const fields = `id isAdult title { english romaji native } description(asHtml:false)
  coverImage { extraLarge large medium color } bannerImage averageScore popularity genres episodes duration status format season seasonYear siteUrl
  nextAiringEpisode { episode airingAt }`;
const common = `type:ANIME,isAdult:$isAdult,genre:$genre,search:$search`;
export const animeExploreGraphQL = `query AnimeExplore($isAdult:Boolean,$genre:String,$search:String,$year:Int,$status:MediaStatus,$format:MediaFormat,$season:MediaSeason,$rankSeason:MediaSeason,$rankYear:Int,$includeUpcoming:Boolean!,$includeMovies:Boolean!) {
  GenreCollection
  trending:Page(perPage:20) { media(${common},seasonYear:$year,season:$season,status:$status,format:$format,sort:TRENDING_DESC) { ${fields} } }
  topSeason:Page(perPage:20) { media(${common},seasonYear:$rankYear,season:$rankSeason,status:$status,format:$format,sort:[SCORE_DESC,POPULARITY_DESC]) { ${fields} } }
  upcoming:Page(perPage:20) @include(if:$includeUpcoming) { media(${common},seasonYear:$year,season:$season,status:NOT_YET_RELEASED,format:$format,sort:POPULARITY_DESC) { ${fields} } }
  movies:Page(perPage:20) @include(if:$includeMovies) { media(${common},seasonYear:$year,season:$season,status:$status,format:MOVIE,sort:[SCORE_DESC,POPULARITY_DESC]) { ${fields} } }
}`;
export function catalogueAnime(
  row: z.infer<typeof mediaSchema>,
  now = Date.now(),
): AnimeCatalogueTitle {
  const total = row.episodes && row.episodes > 0 ? row.episodes : null;
  let aired: number | null = null;
  if (row.status === "NOT_YET_RELEASED") aired = 0;
  else if (row.status === "FINISHED") aired = total;
  else if (row.nextAiringEpisode) {
    aired = Math.max(
      0,
      row.nextAiringEpisode.episode -
        (row.nextAiringEpisode.airingAt * 1000 > now ? 1 : 0),
    );
    if (total != null) aired = Math.min(total, aired);
  }
  return {
    item: mediaItemSchema.parse(normaliseAnime(row)),
    totalEpisodes: total,
    airedEpisodes: aired,
    season: row.season ?? null,
    format: row.format ?? null,
    releasing: row.status === "RELEASING",
  };
}
export class AnimeExplore {
  private recovered = new TtlCache<ReturnType<typeof normaliseAnime>[]>(
    300000,
    20,
  );
  private cache = new TtlCache<z.infer<typeof responseSchema>>(120000, 30);
  constructor(
    private fetchCatalogue = fetchCatalogueGraphQL,
    private now = () => Date.now(),
    private includeAdult: () => Promise<boolean> = async () => false,
  ) {}
  async snapshots(raw: unknown) {
    const ids = [
      ...new Set(
        z.array(z.number().int().positive().max(2147483647)).max(24).parse(raw),
      ),
    ].sort((a, b) => a - b);
    if (!ids.length) return [];
    return this.recovered.run(JSON.stringify(ids), async () => {
      const data = z
        .object({ Page: pageSchema })
        .parse(
          await this.fetchCatalogue(
            `query RecoverAnimeTitles($ids:[Int]) { Page(perPage:24) { media(type:ANIME,id_in:$ids) { ${fields} } } }`,
            { ids },
          ),
        );
      return data.Page.media.map((row) =>
        mediaItemSchema.parse(normaliseAnime(row)),
      );
    });
  }
  async load(raw: unknown): Promise<AnimeExplorePage> {
    const query = animeExploreQuery.parse(raw);
    const date = new Date(this.now());
    const rankSeason =
      query.season || seasonSchema.options[Math.floor(date.getMonth() / 3)]!;
    const rankYear = query.year ?? date.getFullYear();
    const allowAdult = await this.includeAdult();
    const variables = {
      ...(allowAdult ? {} : { isAdult: false }),
      genre: query.genre || undefined,
      search: query.search || undefined,
      year: query.year ?? undefined,
      status: query.status || undefined,
      format: query.format || undefined,
      season: query.season || undefined,
      rankSeason,
      rankYear,
      includeUpcoming: !query.status || query.status === "NOT_YET_RELEASED",
      includeMovies: !query.format || query.format === "MOVIE",
    };
    const data = await this.cache.run(JSON.stringify(variables), async () =>
      responseSchema.parse(
        await this.fetchCatalogue(animeExploreGraphQL, variables),
      ),
    );
    const rows = (items: z.infer<typeof mediaSchema>[]) =>
      items.filter((row) => allowAdult || !row.isAdult);
    const titleSeason = rankSeason[0]! + rankSeason.slice(1).toLowerCase();
    return {
      genres: data.GenreCollection.filter(
        (genre) => allowAdult || genre.toLowerCase() !== "hentai",
      ),
      sections: [
        {
          id: "trending",
          title: "Trending right now",
          items: rows(data.trending.media).map((row) =>
            catalogueAnime(row, this.now()),
          ),
        },
        {
          id: "season",
          title: `Top anime of ${titleSeason} ${rankYear}`,
          items: rows(data.topSeason.media).map((row) =>
            catalogueAnime(row, this.now()),
          ),
        },
        {
          id: "upcoming",
          title: "Coming soon",
          items:
            query.status && query.status !== "NOT_YET_RELEASED"
              ? []
              : rows(data.upcoming?.media ?? []).map((row) =>
                  catalogueAnime(row, this.now()),
                ),
        },
        {
          id: "movies",
          title: "Top anime movies",
          items:
            query.format && query.format !== "MOVIE"
              ? []
              : rows(data.movies?.media ?? []).map((row) =>
                  catalogueAnime(row, this.now()),
                ),
        },
      ],
    };
  }
}
