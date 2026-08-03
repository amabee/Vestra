import type {
  CastMember,
  MediaDetails,
  MediaItem,
  ReleaseStatus,
  StreamingLink,
} from "@vestra/types";

import type { AnilistMedia, AnilistStatus } from "./types";

/**
 * AniList descriptions contain a limited set of HTML tags. Strip them rather
 * than rendering raw markup — this text is injected into the UI as plain text,
 * so leaving tags in would risk an XSS sink downstream.
 */
function stripHtml(input: string | null | undefined): string | null {
  if (!input) return null;
  const text = input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > 0 ? text : null;
}

function pickTitle(media: AnilistMedia): string {
  return (
    media.title?.english ??
    media.title?.romaji ??
    media.title?.native ??
    `AniList #${media.id}`
  );
}

function pickOriginalTitle(media: AnilistMedia, chosen: string): string | null {
  const candidates = [media.title?.romaji, media.title?.native];
  return candidates.find((t): t is string => Boolean(t) && t !== chosen) ?? null;
}

function mapStatus(status: AnilistStatus | null | undefined): ReleaseStatus {
  switch (status) {
    case "FINISHED":
      return "released";
    case "RELEASING":
    case "HIATUS":
      return "airing";
    case "NOT_YET_RELEASED":
      return "upcoming";
    case "CANCELLED":
      return "cancelled";
    default:
      return "unknown";
  }
}

/** AniList already scores 0–100, which is Vestra's normalised scale. */
function normaliseScore(score: number | null | undefined): number | null {
  if (score === null || score === undefined || score <= 0) return null;
  return Math.min(100, Math.max(0, Math.round(score)));
}

export function normaliseAnime(media: AnilistMedia): MediaItem {
  const title = pickTitle(media);
  // AniList reports per-episode runtime in minutes.
  const durationSeconds = media.duration ? media.duration * 60 : null;
  const isSeries = (media.episodes ?? 0) > 1 || media.format === "TV";

  return {
    source: "anilist",
    kind: "anime",
    sourceId: String(media.id),
    title,
    originalTitle: pickOriginalTitle(media, title),
    year: media.seasonYear ?? null,
    overview: stripHtml(media.description),
    images: {
      poster: media.coverImage?.extraLarge ?? media.coverImage?.large ?? null,
      backdrop: media.bannerImage ?? null,
      thumbnail: media.coverImage?.medium ?? media.coverImage?.large ?? null,
      // AniList ships a dominant colour — a free, high-quality placeholder.
      placeholder: media.coverImage?.color ?? null,
    },
    rating: {
      score: normaliseScore(media.averageScore),
      votes: media.popularity ?? null,
    },
    genres: (media.genres ?? []).map((name) => ({ id: name.toLowerCase(), name })),
    status: mapStatus(media.status),
    durationSeconds,
    isSeries,
    sourceUrl: media.siteUrl ?? `https://anilist.co/anime/${media.id}`,
  };
}

function mapCharacters(media: AnilistMedia): CastMember[] {
  return (media.characters?.edges ?? [])
    .flatMap((edge) => {
      const node = edge?.node;
      if (!node) return [];
      return [
        {
          id: String(node.id),
          name: node.name?.full ?? "Unknown",
          role: edge.role ?? null,
          image: node.image?.medium ?? null,
        },
      ];
    })
    .slice(0, 20);
}

/**
 * Official streaming links AniList already returns on the details query.
 *
 * These point at licensed services (Crunchyroll, HIDIVE, Netflix, Muse Asia on
 * YouTube) and are usually episode-specific, so they are the best legal
 * "watch this now" signal Vestra has for anime.
 */
function mapStreamingEpisodes(media: AnilistMedia): StreamingLink[] {
  const seen = new Set<string>();

  return (media.streamingEpisodes ?? []).flatMap((episode) => {
    if (!episode?.url || !episode.site) return [];

    // Collapse per-episode entries down to one link per service; the details
    // panel wants "where can I watch this", not 1,000 episode rows.
    if (seen.has(episode.site)) return [];
    seen.add(episode.site);

    return [
      {
        service: episode.site,
        url: episode.url,
        // AniList does not say whether the service is free or paid.
        access: "unknown" as const,
        logo: null,
        episodeTitle: episode.title ?? null,
        region: null,
      },
    ];
  });
}

export function normaliseAnimeDetails(media: AnilistMedia): MediaDetails {
  const related = (media.relations?.edges ?? [])
    .flatMap((edge) => {
      const node = edge?.node;
      // Manga/novel relations have no place in a video library.
      if (!node || node.type !== "ANIME") return [];
      return [normaliseAnime(node)];
    })
    .slice(0, 12);

  return {
    ...normaliseAnime(media),
    tagline: null,
    // AniList has no age-rating system beyond an adult flag.
    certification: media.isAdult ? "18+" : null,
    cast: mapCharacters(media),
    // AniList exposes episode counts, not a full episode list, so seasons stay empty.
    seasons: [],
    related,
    studios: (media.studios?.nodes ?? []).map((s) => s.name),
    countries: media.countryOfOrigin ? [media.countryOfOrigin] : [],
    languages: [],
    streaming: mapStreamingEpisodes(media),
    external: {
      anilistId: String(media.id),
      ...(media.format ? { format: media.format } : {}),
      ...(media.episodes ? { episodes: String(media.episodes) } : {}),
    },
  };
}
