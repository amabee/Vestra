/**
 * Which AniList entry is season N of a series.
 *
 * AniList files every season as its own entry, joined to its neighbours by
 * PREQUEL and SEQUEL links. A search for the bare series title returns all of
 * them, and the titles are no help: "Isekai Nonbiri Nouka" and "Isekai Nonbiri
 * Nouka 2" both contain the folder name, so whichever the provider happens to
 * list first wins. That is how a folder of season-two files ends up carrying
 * season one's artwork, synopsis and episode count.
 *
 * Two callers need this. The scanner, so a folder is attached to the right
 * entry in the first place; and the skip-time lookup, where asking for the
 * wrong season returns perfectly valid timings for the wrong show — worse than
 * no timings, because the button appears part way through an episode.
 *
 * The chain is walked rather than trusted. Prequel links lead back to the
 * first season regardless of which entry was matched, then sequel links walk
 * forward to the season wanted. Only TV entries are followed, so films, OVAs
 * and specials in the same family do not shift the count.
 *
 * Returns null when the season cannot be reached. Callers are expected to
 * degrade — show no skip button, keep the entry already matched — rather than
 * substitute a guess.
 */

const ANILIST_ENDPOINT = "https://graphql.anilist.co";

const TV_FORMATS = new Set(["TV", "TV_SHORT"]);

/** A series can be long, but not this long. Guards against a relation cycle. */
const MAX_HOPS = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface RelatedMedia {
  id: number;
  idMal: number | null;
  format: string | null;
  relationType: string;
}

export interface SeasonMedia {
  id: number;
  idMal: number | null;
  relations: RelatedMedia[];
}

const MEDIA_QUERY = `query($id:Int!){
  Media(id:$id, type:ANIME){
    id
    idMal
    relations {
      edges {
        relationType
        node { id idMal format type }
      }
    }
  }
}`;

/** One entry and its relations. Cached including misses. */
const mediaCache = new Map<number, SeasonMedia | null>();

async function fetchMedia(anilistId: number): Promise<SeasonMedia | null> {
  const cached = mediaCache.get(anilistId);
  if (cached !== undefined) return cached;

  const media = await requestMedia(anilistId);
  mediaCache.set(anilistId, media);
  return media;
}

async function requestMedia(anilistId: number): Promise<SeasonMedia | null> {
  try {
    const response = await fetch(ANILIST_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: MEDIA_QUERY, variables: { id: anilistId } }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) return null;

    const payload: unknown = await response.json();
    if (!isRecord(payload) || !isRecord(payload.data) || !isRecord(payload.data.Media)) {
      return null;
    }

    const media = payload.data.Media;
    const relations: RelatedMedia[] = [];

    const edges = isRecord(media.relations) ? media.relations.edges : null;

    if (Array.isArray(edges)) {
      for (const edge of edges) {
        if (!isRecord(edge) || !isRecord(edge.node)) continue;
        if (edge.node.type !== "ANIME") continue;
        if (typeof edge.node.id !== "number") continue;

        relations.push({
          id: edge.node.id,
          idMal: typeof edge.node.idMal === "number" ? edge.node.idMal : null,
          format: typeof edge.node.format === "string" ? edge.node.format : null,
          relationType: String(edge.relationType ?? ""),
        });
      }
    }

    return {
      id: typeof media.id === "number" ? media.id : anilistId,
      idMal: typeof media.idMal === "number" ? media.idMal : null,
      relations,
    };
  } catch {
    return null;
  }
}

/** The first relation of a kind that is a TV entry and has not been visited. */
function step(
  media: SeasonMedia,
  relationType: "PREQUEL" | "SEQUEL",
  seen: ReadonlySet<number>,
): RelatedMedia | undefined {
  return media.relations.find(
    (relation) =>
      relation.relationType === relationType &&
      // A null format is followed: unaired sequels often have none set yet,
      // and refusing them would strand the newest season.
      (relation.format === null || TV_FORMATS.has(relation.format)) &&
      !seen.has(relation.id),
  );
}

/** Entries already resolved for a season, including misses. */
const seasonCache = new Map<string, SeasonMedia | null>();

/**
 * Walk from any entry in a series to the entry for a given season.
 *
 * The starting point does not need to be season one — that is the whole
 * point, since the matched entry is usually whichever one a title search
 * surfaced first.
 */
export async function resolveSeasonMedia(
  anilistId: string | number,
  seasonNumber: number,
): Promise<SeasonMedia | null> {
  const numeric =
    typeof anilistId === "number" ? anilistId : Number.parseInt(anilistId, 10);
  if (!Number.isFinite(numeric)) return null;

  if (seasonNumber <= 1) {
    // Still a walk: the matched entry may itself be a later season.
    return walkToFirstSeason(numeric);
  }

  const key = `${numeric}:${seasonNumber}`;
  const cached = seasonCache.get(key);
  if (cached !== undefined) return cached;

  let media = await walkToFirstSeason(numeric);
  if (!media) {
    seasonCache.set(key, null);
    return null;
  }

  const seen = new Set<number>([media.id]);

  for (let index = 1; index < seasonNumber; index += 1) {
    const sequel = step(media, "SEQUEL", seen);

    if (!sequel) {
      // The series does not run that far. Refuse rather than guess.
      seasonCache.set(key, null);
      return null;
    }

    const next = await fetchMedia(sequel.id);
    if (!next) {
      seasonCache.set(key, null);
      return null;
    }

    seen.add(next.id);
    media = next;
  }

  seasonCache.set(key, media);
  return media;
}

async function walkToFirstSeason(anilistId: number): Promise<SeasonMedia | null> {
  let media = await fetchMedia(anilistId);
  if (!media) return null;

  const seen = new Set<number>([media.id]);

  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const prequel = step(media, "PREQUEL", seen);
    if (!prequel) break;

    const next = await fetchMedia(prequel.id);
    if (!next) break;

    seen.add(next.id);
    media = next;
  }

  return media;
}

/** The MyAnimeList id for an entry, which is what AniSkip is keyed by. */
export async function resolveMalId(anilistId: string): Promise<number | null> {
  const numeric = Number.parseInt(anilistId, 10);
  if (!Number.isFinite(numeric)) return null;

  const media = await fetchMedia(numeric);
  return media?.idMal ?? null;
}

/** The MyAnimeList id for a particular season of a series. */
export async function resolveSeasonMalId(
  anilistId: string,
  seasonNumber: number,
): Promise<number | null> {
  /*
    Season one is taken as the entry already matched, without walking.

    The walk would be defensible, but the player falls back to season one
    whenever a filename carries no SxxExx marker, and for a folder of
    unmarked season-two files that fallback plus a walk back to season one
    would move a currently-correct lookup onto the wrong show. Skip times are
    not what is being fixed here, so this path stays as it was.
  */
  if (seasonNumber <= 1) return resolveMalId(anilistId);

  const media = await resolveSeasonMedia(anilistId, seasonNumber);
  return media?.idMal ?? null;
}

/**
 * The AniList id for a particular season of a series.
 *
 * Returned as a string because that is how ids travel through `MediaRef`.
 */
export async function resolveSeasonAnilistId(
  anilistId: string,
  seasonNumber: number,
): Promise<string | null> {
  const media = await resolveSeasonMedia(anilistId, seasonNumber);
  return media === null ? null : String(media.id);
}
