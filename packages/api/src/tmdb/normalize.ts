import { TMDB_IMAGE_BASE, TMDB_IMAGE_SIZES } from "@vestra/config/constants";
import type {
  CastMember,
  Episode,
  MediaDetails,
  MediaItem,
  MediaKind,
  ReleaseStatus,
  Season,
} from "@vestra/types";

import type {
  TmdbCastMember,
  TmdbEpisode,
  TmdbGenre,
  TmdbMovie,
  TmdbSeason,
  TmdbTv,
} from "./types";

/* -----------------------------------------------------------------------------
 * Images
 * -------------------------------------------------------------------------- */

export function tmdbImage(path: string | null | undefined, size: string): string | null {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

/* -----------------------------------------------------------------------------
 * Scalars
 * -------------------------------------------------------------------------- */

function yearFrom(date: string | null | undefined): number | null {
  if (!date) return null;
  const year = Number.parseInt(date.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

/** TMDb rates 0–10; Vestra normalises every provider to 0–100. */
function normaliseScore(voteAverage: number | undefined): number | null {
  if (voteAverage === undefined || voteAverage <= 0) return null;
  return Math.round(voteAverage * 10);
}

function mapStatus(status: string | undefined): ReleaseStatus {
  switch (status) {
    case "Released":
    case "Ended":
      return "released";
    case "Returning Series":
    case "In Production":
      return "airing";
    case "Planned":
    case "Post Production":
      return "upcoming";
    case "Canceled":
    case "Cancelled":
      return "cancelled";
    default:
      return "unknown";
  }
}

function mapGenres(genres: TmdbGenre[] | undefined) {
  return (genres ?? []).map((g) => ({ id: String(g.id), name: g.name }));
}

function mapCast(cast: TmdbCastMember[] | undefined): CastMember[] {
  return (cast ?? []).slice(0, 20).map((person) => ({
    id: String(person.id),
    name: person.name,
    role: person.character ?? null,
    image: tmdbImage(person.profile_path, TMDB_IMAGE_SIZES.profile.medium),
  }));
}

/**
 * A Korean-origin TV show is surfaced as a K-drama; everything else stays "tv".
 * TMDb has no K-drama category, so Vestra derives one from origin country.
 */
export function tvKind(show: Pick<TmdbTv, "origin_country" | "original_language">): MediaKind {
  const isKorean =
    show.origin_country?.includes("KR") === true || show.original_language === "ko";
  return isKorean ? "kdrama" : "tv";
}

/* -----------------------------------------------------------------------------
 * Movies
 * -------------------------------------------------------------------------- */

export function normaliseMovie(movie: TmdbMovie): MediaItem {
  return {
    source: "tmdb",
    kind: "movie",
    sourceId: String(movie.id),
    title: movie.title,
    originalTitle: movie.original_title !== movie.title ? (movie.original_title ?? null) : null,
    year: yearFrom(movie.release_date),
    overview: movie.overview ?? null,
    images: {
      poster: tmdbImage(movie.poster_path, TMDB_IMAGE_SIZES.poster.medium),
      backdrop: tmdbImage(movie.backdrop_path, TMDB_IMAGE_SIZES.backdrop.large),
      thumbnail: tmdbImage(movie.poster_path, TMDB_IMAGE_SIZES.poster.small),
      placeholder: null,
    },
    rating: {
      score: normaliseScore(movie.vote_average),
      votes: movie.vote_count ?? null,
    },
    genres: mapGenres(movie.genres),
    status: mapStatus(movie.status),
    durationSeconds: movie.runtime ? movie.runtime * 60 : null,
    isSeries: false,
    sourceUrl: `https://www.themoviedb.org/movie/${movie.id}`,
  };
}

/**
 * Pull the US certification out of a movie's release-date block.
 * TMDb nests one entry per country, each with several release types.
 */
function movieCertification(movie: TmdbMovie): string | null {
  const us = movie.release_dates?.results?.find((entry) => entry.iso_3166_1 === "US");
  const certification = us?.release_dates?.find(
    (entry) => entry.certification && entry.certification.trim().length > 0,
  )?.certification;
  return certification?.trim() ?? null;
}

function tvCertification(show: TmdbTv): string | null {
  const us = show.content_ratings?.results?.find((entry) => entry.iso_3166_1 === "US");
  const rating = us?.rating?.trim();
  return rating && rating.length > 0 ? rating : null;
}

export function normaliseMovieDetails(movie: TmdbMovie): MediaDetails {
  return {
    ...normaliseMovie(movie),
    tagline: movie.tagline ?? null,
    certification: movieCertification(movie),
    cast: mapCast(movie.credits?.cast),
    seasons: [],
    related: (movie.similar?.results ?? []).slice(0, 12).map(normaliseMovie),
    studios: (movie.production_companies ?? []).map((c) => c.name),
    countries: (movie.production_countries ?? []).map((c) => c.iso_3166_1),
    languages: (movie.spoken_languages ?? []).map((l) => l.english_name),
    external: { tmdbId: String(movie.id) },
  };
}

/* -----------------------------------------------------------------------------
 * TV / K-drama
 * -------------------------------------------------------------------------- */

export function normaliseTv(show: TmdbTv): MediaItem {
  const runtime = show.episode_run_time?.[0];

  return {
    source: "tmdb",
    kind: tvKind(show),
    sourceId: String(show.id),
    title: show.name,
    originalTitle: show.original_name !== show.name ? (show.original_name ?? null) : null,
    year: yearFrom(show.first_air_date),
    overview: show.overview ?? null,
    images: {
      poster: tmdbImage(show.poster_path, TMDB_IMAGE_SIZES.poster.medium),
      backdrop: tmdbImage(show.backdrop_path, TMDB_IMAGE_SIZES.backdrop.large),
      thumbnail: tmdbImage(show.poster_path, TMDB_IMAGE_SIZES.poster.small),
      placeholder: null,
    },
    rating: {
      score: normaliseScore(show.vote_average),
      votes: show.vote_count ?? null,
    },
    genres: mapGenres(show.genres),
    status: mapStatus(show.status),
    durationSeconds: runtime ? runtime * 60 : null,
    isSeries: true,
    sourceUrl: `https://www.themoviedb.org/tv/${show.id}`,
  };
}

export function normaliseEpisode(episode: TmdbEpisode): Episode {
  return {
    id: String(episode.id),
    seasonNumber: episode.season_number,
    episodeNumber: episode.episode_number,
    title: episode.name ?? null,
    overview: episode.overview ?? null,
    still: tmdbImage(episode.still_path, TMDB_IMAGE_SIZES.still.medium),
    airDate: episode.air_date ?? null,
    durationSeconds: episode.runtime ? episode.runtime * 60 : null,
  };
}

export function normaliseSeason(season: TmdbSeason): Season {
  return {
    id: String(season.id),
    seasonNumber: season.season_number,
    title: season.name ?? null,
    episodeCount: season.episode_count ?? season.episodes?.length ?? 0,
    poster: tmdbImage(season.poster_path, TMDB_IMAGE_SIZES.poster.small),
    episodes: (season.episodes ?? []).map(normaliseEpisode),
  };
}

export function normaliseTvDetails(show: TmdbTv): MediaDetails {
  return {
    ...normaliseTv(show),
    tagline: show.tagline ?? null,
    certification: tvCertification(show),
    cast: mapCast(show.credits?.cast),
    // Season 0 is "Specials"; keep the main run only.
    seasons: (show.seasons ?? []).filter((s) => s.season_number > 0).map(normaliseSeason),
    related: (show.similar?.results ?? []).slice(0, 12).map(normaliseTv),
    studios: (show.production_companies ?? []).map((c) => c.name),
    countries: (show.production_countries ?? []).map((c) => c.iso_3166_1),
    languages: (show.spoken_languages ?? []).map((l) => l.english_name),
    external: { tmdbId: String(show.id) },
  };
}
