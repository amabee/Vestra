/** Raw AniList GraphQL shapes — only the fields Vestra consumes. */

export interface AnilistTitle {
  romaji?: string | null;
  english?: string | null;
  native?: string | null;
}

export interface AnilistCoverImage {
  extraLarge?: string | null;
  large?: string | null;
  medium?: string | null;
  color?: string | null;
}

export type AnilistStatus =
  | "FINISHED"
  | "RELEASING"
  | "NOT_YET_RELEASED"
  | "CANCELLED"
  | "HIATUS";

export interface AnilistMedia {
  id: number;
  title?: AnilistTitle | null;
  description?: string | null;
  coverImage?: AnilistCoverImage | null;
  bannerImage?: string | null;
  averageScore?: number | null;
  popularity?: number | null;
  genres?: string[] | null;
  episodes?: number | null;
  /** Minutes per episode. */
  duration?: number | null;
  status?: AnilistStatus | null;
  format?: string | null;
  seasonYear?: number | null;
  siteUrl?: string | null;
  isAdult?: boolean | null;
  countryOfOrigin?: string | null;
  studios?: { nodes?: { name: string }[] | null } | null;
  characters?: {
    edges?: {
      role?: string | null;
      node?: {
        id: number;
        name?: { full?: string | null } | null;
        image?: { medium?: string | null } | null;
      } | null;
    }[] | null;
  } | null;
  relations?: {
    edges?: {
      relationType?: string | null;
      node?: (AnilistMedia & { type?: string | null }) | null;
    }[] | null;
  } | null;
  streamingEpisodes?:
    | { title?: string | null; thumbnail?: string | null; url?: string | null; site?: string | null }[]
    | null;
}

export interface AnilistPageInfo {
  total?: number | null;
  currentPage?: number | null;
  lastPage?: number | null;
  hasNextPage?: boolean | null;
}

export interface AnilistPageResponse {
  Page?: {
    pageInfo?: AnilistPageInfo | null;
    media?: AnilistMedia[] | null;
  } | null;
}

export interface AnilistMediaResponse {
  Media?: AnilistMedia | null;
}

export interface AnilistGraphQLResponse<T> {
  data?: T | null;
  errors?: { message: string; status?: number }[] | null;
}
