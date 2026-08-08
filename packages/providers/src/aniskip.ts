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
 * exposes `idMal`, which is how the two are bridged — see `./seasons`, which
 * also handles the fact that AniList files each season as its own entry.
 *
 * Responses are checked by hand rather than with a schema library: this
 * package has no validation dependency, and the shape is three fields deep.
 */

import { resolveSeasonMalId } from "./seasons";

const ANISKIP_ENDPOINT = "https://api.aniskip.com/v2/skip-times";

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
