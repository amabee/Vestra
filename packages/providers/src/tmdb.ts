import { tmdb } from "@vestra/api";
import { isTmdbConfigured } from "@vestra/config";
import type { MetadataProvider } from "@vestra/provider-sdk";

/** TMDb — films, series and (via Korean-origin series) K-dramas. */
export function createTmdbProvider(): MetadataProvider {
  return {
    id: "tmdb",
    name: "Movies & TV",
    kinds: ["movie", "tv", "kdrama"],
    capabilities: { search: true, details: true, trending: true },

    isAvailable: () => isTmdbConfigured(),

    async search(query, context) {
      const result = await tmdb.searchTmdb(query.query, {
        page: query.page,
        signal: context.signal,
      });

      return {
        items: result.items.slice(0, query.perPage),
        totalResults: result.totalResults,
        hasMore: result.hasMore,
      };
    },

    async getDetails(ref) {
      // K-drama is a Vestra-derived kind; TMDb serves it from the /tv endpoint.
      return ref.kind === "movie"
        ? tmdb.getMovieDetails(ref.sourceId)
        : tmdb.getTvDetails(ref.sourceId);
    },

    async getTrending(kind) {
      switch (kind) {
        case "movie":
          return tmdb.getTrendingMovies("week");
        case "kdrama":
          return tmdb.getTrendingKdramas();
        case "tv":
          return tmdb.getTrendingTv("week");
        default:
          return [];
      }
    },
  };
}
