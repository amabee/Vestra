import { mediaDetailsSchema } from "@vestra/types";
import { TtlCache } from "./ttl-cache";
import { tmdb } from "@vestra/api";
import type {
  StreamSourceProvider,
  Anime,
  Episode,
} from "@vestra/extension-host";
import { parseEpisodes } from "@vestra/extension-host";
import type { MediaItem, MediaDetails, Season } from "@vestra/types";
import type { ProviderContext } from "@vestra/provider-sdk";

export interface SourceCatalogue {
  search(
    query: string,
    kind: "movie" | "tv",
    context?: ProviderContext,
  ): Promise<MediaItem[]>;
  popular(kind: "movie" | "tv", page: number): Promise<MediaItem[]>;
  details(
    kind: "movie" | "tv",
    id: string,
    context?: ProviderContext,
  ): Promise<MediaDetails>;
  season(
    id: string,
    number: number,
    context?: ProviderContext,
  ): Promise<Season>;
}
export const tmdbSourceCatalogue: SourceCatalogue = {
  search: (query, kind, context) =>
    kind === "movie"
      ? tmdb.searchMovies(query, { signal: context?.signal })
      : tmdb.searchTv(query, { signal: context?.signal }),
  popular: (kind, page) =>
    kind === "movie" ? tmdb.getPopularMovies(page) : tmdb.getPopularTv(page),
  details: (kind, id, context) =>
    kind === "movie"
      ? tmdb.getMovieDetails(id, { signal: context?.signal })
      : tmdb.getTvDetails(id, { signal: context?.signal }),
  season: (id, number, context) =>
    tmdb.getSeason(id, number, { signal: context?.signal }),
};
/** Metadata is host-owned. The guest only filters candidate IDs and resolves video. */
export function withSourceCatalogue(
  source: StreamSourceProvider,
  call: (
    method: string,
    args: unknown[],
    context?: ProviderContext,
  ) => Promise<unknown>,
  catalogue: SourceCatalogue = tmdbSourceCatalogue,
): StreamSourceProvider {
  const popularPages = new TtlCache<MediaItem[]>(15 * 60_000, 128);
  const kindOf = (kind: unknown): "movie" | "tv" => {
    if (kind !== "movie" && kind !== "tv")
      throw Error("Choose Movies or TV series.");
    return kind;
  };
  const parse = (id: string) => {
    const parts = id.split("|");
    if (
      parts.length !== 2 ||
      !["movie", "tv"].includes(parts[0]!) ||
      !/^[1-9]\d{0,9}$/.test(parts[1]!)
    )
      throw Error("Invalid catalogue title.");
    return { kind: kindOf(parts[0]), id: parts[1]! };
  };
  const match = async (
    rows: MediaItem[],
    kind: "movie" | "tv",
    limit: number,
    context?: ProviderContext,
  ): Promise<Anime[]> => {
    const candidates = new Map<string, MediaItem>();
    for (const row of rows.slice(0, 50))
      if (
        (row.kind === kind || (kind === "tv" && row.kind === "kdrama")) &&
        row.source === "tmdb" &&
        /^[1-9]\d{0,9}$/.test(row.sourceId)
      )
        candidates.set(`${kind}|${row.sourceId}`, row);
    if (!candidates.size) return [];
    const result = await call(
      "matchCatalogue",
      [[...candidates.keys()]],
      context,
    );
    if (
      !Array.isArray(result) ||
      result.length > candidates.size ||
      new Set(result).size !== result.length ||
      result.some((id) => typeof id !== "string" || !candidates.has(id))
    )
      throw Error("Source returned invalid catalogue matches.");
    return result.slice(0, limit).map((id) => {
      const row = candidates.get(id)!;
      return {
        id,
        kind,
        title: row.title,
        provider: source.id,
        ...(row.year ? { year: row.year } : {}),
        ...(row.images.poster ? { cover: row.images.poster } : {}),
      };
    });
  };
  return {
    ...source,
    catalogueSource: "tmdb",
    async catalogueDetails(titleId) {
      const parsed = parse(titleId);
      const details = await catalogue.details(parsed.kind, parsed.id);
      if (
        details.source !== "tmdb" ||
        details.sourceId !== parsed.id ||
        !(
          details.kind === parsed.kind ||
          (parsed.kind === "tv" && details.kind === "kdrama")
        )
      )
        throw Error("Catalogue returned a different title.");
      return mediaDetailsSchema.parse({
        ...details,
        source: source.id,
        sourceId: titleId,
        kind: parsed.kind,
      });
    },
    async search(query, options, context) {
      const kind = kindOf(options?.kind),
        limit = Math.min(50, Math.max(1, options?.limit ?? 20));
      const direct = /^(?:tmdb:)?([1-9]\d{0,9})$/i.exec(query.trim());
      if (direct)
        return match(
          [await catalogue.details(kind, direct[1]!, context)],
          kind,
          limit,
          context,
        );
      return match(
        await catalogue.search(query, kind, context),
        kind,
        limit,
        context,
      );
    },
    browseCategories: ["popular"],
    async browse(category, options, context) {
      if (category !== "popular")
        throw Error("This source offers the Popular collection.");
      if (
        !Number.isInteger(options.page) ||
        options.page < 1 ||
        options.page > 100 ||
        !Number.isInteger(options.limit) ||
        options.limit < 1 ||
        options.limit > 24
      )
        throw Error("Invalid catalogue pagination.");
      const kind = kindOf(options.kind);
      // TMDb popular pages contain 20 raw records. Slice before availability
      // matching, so a 14-item UI page never discards the six remaining records.
      const start = (options.page - 1) * options.limit,
        rawPage = Math.floor(start / 20) + 1,
        offset = start % 20;
      const load = (page: number) =>
        popularPages.run(`${kind}:${page}`, () =>
          catalogue.popular(kind, page),
        );
      const first = await load(rawPage);
      const second =
        offset + options.limit > 20 && first.length === 20
          ? await load(rawPage + 1)
          : [];
      const all = [...first, ...second],
        rows = all.slice(offset, offset + options.limit);
      const hasMore =
        all.length > offset + options.limit ||
        (second.length || first.length) === 20;
      return {
        items: await match(rows, kind, Math.min(24, options.limit), context),
        hasMore,
      };
    },
    async getEpisodes(titleId, context) {
      const title = parse(titleId);
      if (title.kind === "movie") return source.getEpisodes(titleId, context);
      const details = await catalogue.details("tv", title.id, context);
      if (
        details.source !== "tmdb" ||
        details.sourceId !== title.id ||
        !["tv", "kdrama"].includes(details.kind)
      )
        throw Error("Catalogue returned a different series.");
      if (details.seasons.length > 60)
        throw Error(
          "This series has too many seasons for this source's episode lookup.",
        );
      const episodes: Episode[] = [];
      // At most two season requests in flight, never one network burst per episode.
      for (let index = 0; index < details.seasons.length; index += 2) {
        context?.signal?.throwIfAborted();
        const seasons = await Promise.all(
          details.seasons
            .slice(index, index + 2)
            .map((row) =>
              catalogue.season(title.id, row.seasonNumber, context),
            ),
        );
        for (const season of seasons)
          for (const ep of season.episodes) {
            if (
              !ep.airDate ||
              !/^\d{4}-\d{2}-\d{2}/.test(ep.airDate) ||
              ep.airDate.slice(0, 10) > new Date().toISOString().slice(0, 10)
            )
              continue;
            episodes.push({
              id: `${titleId}|s${ep.seasonNumber}|e${ep.episodeNumber}`,
              animeId: titleId,
              season: ep.seasonNumber,
              number: ep.episodeNumber,
              ...(ep.title ? { title: ep.title } : {}),
            });
            if (episodes.length > 2000)
              throw Error("Too many catalogue episodes.");
          }
      }
      const raw = await call("getEpisodes", [titleId, episodes], context);
      const parsed = parseEpisodes(raw);
      if (
        parsed.errors.length ||
        !parsed.value ||
        parsed.value.some(
          (row) =>
            row.animeId !== titleId ||
            !episodes.some(
              (candidate) =>
                candidate.id === row.id &&
                candidate.season === row.season &&
                candidate.number === row.number,
            ),
        ) ||
        new Set(parsed.value.map((row) => row.id)).size !== parsed.value.length
      )
        throw Error("Source returned invalid catalogue episodes.");
      return parsed.value;
    },
  };
}
