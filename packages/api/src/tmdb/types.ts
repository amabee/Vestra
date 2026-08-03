/** Raw TMDb API shapes — only the fields Vestra actually consumes. */

/** `watch/providers` payload, powered by JustWatch. */
export interface TmdbWatchProviderEntry {
  provider_id: number;
  provider_name: string;
  logo_path?: string | null;
}

export interface TmdbWatchProviders {
  results?: Record<
    string,
    {
      /** TMDb's aggregated "where to watch" page for the region. */
      link?: string;
      flatrate?: TmdbWatchProviderEntry[];
      free?: TmdbWatchProviderEntry[];
      ads?: TmdbWatchProviderEntry[];
      rent?: TmdbWatchProviderEntry[];
      buy?: TmdbWatchProviderEntry[];
    }
  >;
}

export interface TmdbPaged<T> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}

export interface TmdbMovie {
  id: number;
  title: string;
  original_title?: string;
  overview?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string | null;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
  genres?: TmdbGenre[];
  runtime?: number | null;
  tagline?: string | null;
  status?: string;
  adult?: boolean;
  origin_country?: string[];
  original_language?: string;
  production_companies?: { id: number; name: string }[];
  production_countries?: { iso_3166_1: string; name: string }[];
  spoken_languages?: { iso_639_1: string; english_name: string }[];
  credits?: TmdbCredits;
  similar?: TmdbPaged<TmdbMovie>;
  /** Requires `append_to_response=release_dates`. */
  release_dates?: {
    results?: {
      iso_3166_1: string;
      release_dates?: { certification?: string; type?: number }[];
    }[];
  };
  /** Requires `append_to_response=watch/providers`. */
  "watch/providers"?: TmdbWatchProviders;
  media_type?: "movie";
}

export interface TmdbTv {
  id: number;
  name: string;
  original_name?: string;
  overview?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  first_air_date?: string | null;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
  genres?: TmdbGenre[];
  episode_run_time?: number[];
  tagline?: string | null;
  status?: string;
  adult?: boolean;
  origin_country?: string[];
  original_language?: string;
  number_of_seasons?: number;
  seasons?: TmdbSeason[];
  production_companies?: { id: number; name: string }[];
  production_countries?: { iso_3166_1: string; name: string }[];
  spoken_languages?: { iso_639_1: string; english_name: string }[];
  credits?: TmdbCredits;
  similar?: TmdbPaged<TmdbTv>;
  /** Requires `append_to_response=content_ratings`. */
  content_ratings?: {
    results?: { iso_3166_1: string; rating?: string }[];
  };
  /** Requires `append_to_response=watch/providers`. */
  "watch/providers"?: TmdbWatchProviders;
  media_type?: "tv";
}

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbCredits {
  cast?: TmdbCastMember[];
}

export interface TmdbCastMember {
  id: number;
  name: string;
  character?: string | null;
  profile_path?: string | null;
  order?: number;
}

export interface TmdbSeason {
  id: number;
  season_number: number;
  name?: string | null;
  episode_count?: number;
  poster_path?: string | null;
  episodes?: TmdbEpisode[];
}

export interface TmdbEpisode {
  id: number;
  season_number: number;
  episode_number: number;
  name?: string | null;
  overview?: string | null;
  still_path?: string | null;
  air_date?: string | null;
  runtime?: number | null;
}

/** `/search/multi` mixes movies, TV and people. */
export type TmdbMultiResult =
  | (TmdbMovie & { media_type: "movie" })
  | (TmdbTv & { media_type: "tv" })
  | { id: number; media_type: "person"; name: string };
