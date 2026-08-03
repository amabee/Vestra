import { anilist } from "@vestra/api";
import { isAnilistConfigured } from "@vestra/config";
import type { MetadataProvider } from "@vestra/provider-sdk";

/** AniList — anime. Public GraphQL, so it needs no credentials. */
export function createAnilistProvider(): MetadataProvider {
  return {
    id: "anilist",
    name: "Anime",
    kinds: ["anime"],
    capabilities: { search: true, details: true, trending: true },

    isAvailable: () => isAnilistConfigured(),

    async search(query) {
      return anilist.searchAnime(query.query, {
        page: query.page,
        perPage: query.perPage,
      });
    },

    async getDetails(ref) {
      return anilist.getAnimeDetails(ref.sourceId);
    },

    async getTrending(kind) {
      return kind === "anime" ? anilist.getTrendingAnime(1, 20) : [];
    },
  };
}
