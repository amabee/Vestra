import { z } from "zod";
import {
  mediaKey,
  watchlistStatusSchema,
  type MediaItem,
  type WatchlistEntry,
  type HistoryEntry,
  type WatchProgress,
} from "@vestra/types";
import type { AnimePlaylist } from "../shared/playlists";
import type { AnimeSchedulePage } from "../shared/anime-hub";
import { animeHomeModel } from "../shared/anime-lists";
import { fetchCatalogueGraphQL } from "./catalogue-graphql";
import { TtlCache } from "./ttl-cache";

export const scheduleQuerySchema = z
  .object({
    from: z.number().int().min(0).max(4102444800),
    until: z.number().int().min(0).max(4102444800),
    status: watchlistStatusSchema.or(z.literal("all")).default("all"),
  })
  .refine(
    (q) => q.until > q.from && q.until - q.from <= 8 * 86400,
    "Choose a calendar week.",
  );
const candidatesSchema = z.object({
  media: z
    .array(
      z.object({
        id: z.number().int().positive(),
        title: z.object({
          english: z.string().nullish(),
          romaji: z.string().nullish(),
          native: z.string().nullish(),
        }),
        seasonYear: z.number().int().nullish(),
      }),
    )
    .max(5),
});
const airingSchema = z.object({
  Page: z.object({
    pageInfo: z.object({ hasNextPage: z.boolean() }),
    airingSchedules: z
      .array(
        z.object({
          id: z.number().int(),
          mediaId: z.number().int().positive(),
          episode: z.number().int().nonnegative(),
          airingAt: z.number().int().nonnegative(),
        }),
      )
      .max(50),
  }),
});
export const scheduleGraphQL = `query SavedAnimeWeek($ids:[Int],$from:Int,$until:Int,$page:Int) {
  Page(page:$page,perPage:50) { pageInfo { hasNextPage }
    airingSchedules(mediaId_in:$ids,airingAt_greater:$from,airingAt_lesser:$until,sort:TIME) { id mediaId episode airingAt }
  }
}`;
export interface SavedAnimeData {
  watchlist: WatchlistEntry[];
  history: HistoryEntry[];
  playlists: AnimePlaylist[];
  progress: Record<string, WatchProgress>;
}
const normalize = (title: string) =>
  title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

/** Broadcast metadata is matched to saved identities, never guessed from queue order. */
export class AnimeSchedule {
  private matches = new Map<string, { id: number | null; until: number }>();
  private weeks = new TtlCache<{
    rows: z.infer<typeof airingSchema>["Page"]["airingSchedules"];
    truncated: boolean;
  }>(120000, 20);
  constructor(
    private readSaved: () => Promise<SavedAnimeData>,
    private fetchCatalogue = fetchCatalogueGraphQL,
    private now = () => Date.now(),
  ) {}
  async load(raw: unknown): Promise<AnimeSchedulePage> {
    const query = scheduleQuerySchema.parse(raw);
    const data = await this.readSaved();
    const model = animeHomeModel(
      data.watchlist,
      data.history,
      data.playlists,
      data.progress,
    );
    const all = model.groups
      .flatMap((group) => group.items)
      .filter((row) => query.status === "all" || row.status === query.status);
    const selected = all.slice(0, 500);
    const resolved = new Map<string, number>();
    const pending: { item: MediaItem; key: string }[] = [];
    for (const { item } of selected) {
      const key = JSON.stringify([
        mediaKey(item),
        item.title,
        item.originalTitle,
        item.year,
      ]);
      const cached = this.matches.get(key);
      if (
        item.source === "anilist" &&
        /^[1-9]\d*$/.test(item.sourceId) &&
        Number(item.sourceId) <= 2147483647
      )
        resolved.set(mediaKey(item), Number(item.sourceId));
      else if (cached && cached.until > this.now()) {
        if (cached.id) resolved.set(mediaKey(item), cached.id);
      } else pending.push({ item, key });
    }
    for (let offset = 0; offset < pending.length; offset += 10) {
      const batch = pending.slice(offset, offset + 10),
        variables: Record<string, unknown> = {};
      const definitions = batch.map((row, i) => {
        variables[`q${i}`] = row.item.title;
        variables[`y${i}`] = row.item.year ?? undefined;
        return `$q${i}:String,$y${i}:Int`;
      });
      const fields = batch.map(
        (_row, i) =>
          `m${i}:Page(perPage:5) { media(type:ANIME,isAdult:false,search:$q${i},seasonYear:$y${i}) { id title { english romaji native } seasonYear } }`,
      );
      const raw = (await this.fetchCatalogue(
        `query MatchSavedAnime(${definitions.join(",")}) { ${fields.join(" ")} }`,
        variables,
      )) as Record<string, unknown>;
      batch.forEach(({ item, key }, i) => {
        const candidates = candidatesSchema.parse(raw[`m${i}`]).media;
        const names = new Set(
          [item.title, item.originalTitle]
            .filter(Boolean)
            .map((name) => normalize(name!)),
        );
        const exact = candidates.filter((row) =>
          Object.values(row.title).some(
            (title) => title && names.has(normalize(title)),
          ),
        );
        const ids = [...new Set(exact.map((row) => row.id))];
        const id = ids.length === 1 ? ids[0]! : null;
        this.matches.set(key, {
          id,
          until: this.now() + (id ? 86400000 : 300000),
        });
        if (id) resolved.set(mediaKey(item), id);
      });
      while (this.matches.size > 1000)
        this.matches.delete(this.matches.keys().next().value!);
    }
    const ids = [...new Set(resolved.values())].sort((a, b) => a - b);
    const unmatched = selected
      .filter((row) => !resolved.has(mediaKey(row.item)))
      .map((row) => row.item.title);
    if (!ids.length)
      return {
        events: [],
        unmatched,
        tracked: selected.length,
        truncated: all.length > 500,
      };
    const response = await this.weeks.run(
      JSON.stringify([ids, query.from, query.until]),
      async () => {
        const rows: z.infer<typeof airingSchema>["Page"]["airingSchedules"] =
          [];
        let more = false;
        for (let page = 1; page <= 10; page++) {
          const result = airingSchema.parse(
            await this.fetchCatalogue(scheduleGraphQL, {
              ids,
              from: query.from - 1,
              until: query.until,
              page,
            }),
          );
          rows.push(...result.Page.airingSchedules);
          more = result.Page.pageInfo.hasNextPage;
          if (!more) break;
        }
        return { rows, truncated: more };
      },
    );
    const events = [
      ...new Map(response.rows.map((event) => [event.id, event])).values(),
    ]
      .filter(
        (event) => event.airingAt >= query.from && event.airingAt < query.until,
      )
      .flatMap((event) => {
        const aliases = selected.filter(
          (row) => resolved.get(mediaKey(row.item)) === event.mediaId,
        );
        const primary = aliases[0];
        if (!primary) return [];
        const keys = new Set(aliases.map((row) => mediaKey(row.item)));
        const watched = Object.values(data.progress).some(
          (progress) =>
            keys.has(mediaKey(progress.ref)) &&
            progress.episodeNumber === event.episode &&
            progress.completed,
        );
        return [
          {
            id: String(event.id),
            airingAt: event.airingAt,
            episode: event.episode,
            item: primary.item,
            status: primary.status,
            watched,
          },
        ];
      })
      .sort((a, b) => a.airingAt - b.airingAt);
    return {
      events,
      unmatched,
      tracked: selected.length,
      truncated: all.length > 500 || response.truncated,
    };
  }
}
