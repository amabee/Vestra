/**
 * Skip times for anime openings and endings.
 *
 * These cannot be read from the files themselves. Releases rarely carry
 * chapter markers — none of the ones this was built against do — and inferring
 * an opening from timings alone is guesswork that cuts into cold opens. The
 * timings instead come from AniSkip, a community database that other anime
 * players use for exactly this.
 *
 * AniSkip is keyed by MyAnimeList id, not AniList id. That is worth stating
 * plainly because the two coincide for a few well-known series, so the mistake
 * looks like it works until it silently 404s on everything else. AniList
 * exposes `idMal`, which is how the two are bridged here.
 *
 * Responses are checked by hand rather than with a schema library: this
 * package has no validation dependency, and the shape is three fields deep.
 */

const ANISKIP_ENDPOINT = "https://api.aniskip.com/v2/skip-times";
const ANILIST_ENDPOINT = "https://graphql.anilist.co";

export interface SkipInterval {
  kind: "opening" | "ending";
  startSeconds: number;
  endSeconds: number;
}

interface RawResult {
  skipType?: unknown;
  interval?: { startTime?: unknown; endTime?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** AniList id to MyAnimeList id. */
const malIdCache = new Map<string, number | null>();

interface RelatedMedia {
  id: number;
  idMal: number | null;
  format: string | null;
  relationType: string;
}

interface MediaNode {
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

async function fetchMedia(anilistId: number): Promise<MediaNode | null> {
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

export async function resolveMalId(anilistId: string): Promise<number | null> {
  const cached = malIdCache.get(anilistId);
  if (cached !== undefined) return cached;

  const numeric = Number.parseInt(anilistId, 10);
  if (!Number.isFinite(numeric)) return null;

  const media = await fetchMedia(numeric);
  const idMal = media?.idMal ?? null;

  malIdCache.set(anilistId, idMal);
  return idMal;
}

/**
 * The MyAnimeList id for a particular season of a series.
 *
 * AniList files each season as its own entry, and the scanner matches a folder
 * to whichever entry it found — commonly the first season, even for later
 * ones. Asking AniSkip for the wrong season returns perfectly valid timings
 * for the wrong show, which is worse than none: the skip button appears part
 * way through an episode and never during the actual opening.
 *
 * The chain is walked rather than trusted. Prequel links lead back to the
 * first season regardless of which entry was matched, then sequel links walk
 * forward to the season wanted. Only TV entries are followed, so films, OVAs
 * and specials in the same family do not shift the count.
 *
 * Returns null when the season cannot be reached, and the caller shows no skip
 * control rather than a misleading one.
 */
const seasonCache = new Map<string, number | null>();

const TV_FORMATS = new Set(["TV", "TV_SHORT"]);
const MAX_HOPS = 12;

export async function resolveSeasonMalId(
  anilistId: string,
  seasonNumber: number,
): Promise<number | null> {
  if (seasonNumber <= 1) return resolveMalId(anilistId);

  const key = `${anilistId}:${seasonNumber}`;
  const cached = seasonCache.get(key);
  if (cached !== undefined) return cached;

  const numeric = Number.parseInt(anilistId, 10);
  if (!Number.isFinite(numeric)) return null;

  let media = await fetchMedia(numeric);
  if (!media) {
    seasonCache.set(key, null);
    return null;
  }

  // Back to the first season.
  const seen = new Set<number>([media.id]);

  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const prequel = media.relations.find(
      (relation) =>
        relation.relationType === "PREQUEL" &&
        (relation.format === null || TV_FORMATS.has(relation.format)) &&
        !seen.has(relation.id),
    );

    if (!prequel) break;

    const next = await fetchMedia(prequel.id);
    if (!next) break;

    seen.add(next.id);
    media = next;
  }

  // Forward to the season asked for.
  for (let step = 1; step < seasonNumber; step += 1) {
    const sequel = media.relations.find(
      (relation) =>
        relation.relationType === "SEQUEL" &&
        (relation.format === null || TV_FORMATS.has(relation.format)) &&
        !seen.has(relation.id),
    );

    if (!sequel) {
      // The series does not go that far; refuse rather than guess.
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

  seasonCache.set(key, media.idMal);
  return media.idMal;
}

/** Skip times keyed by "malId:episode", including misses. */
const skipCache = new Map<string, SkipInterval[]>();

/**
 * Fetch skip intervals for one episode.
 *
 * Returns an empty list when nothing is known, which is the common case for
 * new or obscure series. That is treated as ordinary rather than as an error:
 * the player simply shows no skip control.
 */
export async function fetchSkipTimes(
  malId: number,
  episodeNumber: number,
  episodeLengthSeconds = 0,
): Promise<SkipInterval[]> {
  const key = `${malId}:${episodeNumber}`;
  const cached = skipCache.get(key);
  if (cached) return cached;

  const url =
    `${ANISKIP_ENDPOINT}/${malId}/${episodeNumber}` +
    `?types=op&types=ed&episodeLength=${Math.max(0, Math.round(episodeLengthSeconds))}`;

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    // 404 means "no timings submitted for this episode" — an answer, not a fault.
    if (!response.ok) {
      skipCache.set(key, []);
      return [];
    }

    const payload: unknown = await response.json();

    if (!isRecord(payload) || payload.found !== true || !Array.isArray(payload.results)) {
      skipCache.set(key, []);
      return [];
    }

    const intervals: SkipInterval[] = [];

    for (const entry of payload.results as RawResult[]) {
      const kind =
        entry.skipType === "op"
          ? "opening"
          : entry.skipType === "ed"
            ? "ending"
            : null;

      if (!kind) continue;

      const start = entry.interval?.startTime;
      const end = entry.interval?.endTime;
      if (typeof start !== "number" || typeof end !== "number") continue;

      // Guard against malformed submissions; a zero-length or reversed range
      // would produce a button that does nothing.
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

      intervals.push({ kind, startSeconds: start, endSeconds: end });
    }

    skipCache.set(key, intervals);
    return intervals;
  } catch {
    skipCache.set(key, []);
    return [];
  }
}

/**
 * Skip intervals for an episode of an AniList-sourced series.
 *
 * The season matters as much as the episode: matching a folder to the first
 * season of a series is common, and the later seasons have entirely different
 * timings.
 */
export async function getSkipTimes(
  anilistId: string,
  seasonNumber: number,
  episodeNumber: number,
  episodeLengthSeconds = 0,
): Promise<SkipInterval[]> {
  const malId = await resolveSeasonMalId(anilistId, seasonNumber);
  if (malId === null) return [];
  return fetchSkipTimes(malId, episodeNumber, episodeLengthSeconds);
}
