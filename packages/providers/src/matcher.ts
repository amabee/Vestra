import type { ProviderRegistry } from "@vestra/provider-sdk";
import { getLocalFiles, saveLocalFiles, type StorageDriver } from "@vestra/storage";
import type { LocalMediaFile, MediaItem, MediaRef } from "@vestra/types";

import { normaliseTitle } from "./filename";
import { resolveSeasonAnilistId } from "./seasons";

/**
 * Match scanned local files to catalogue entries.
 *
 * This is what makes an AniList or TMDb title playable: once a file carries a
 * `matchedRef`, the matched-local source adapter can answer "play Frieren" with
 * the user's own file.
 *
 * Deliberately conservative — a wrong match is worse than none, because it
 * attaches the wrong artwork, synopsis and progress to a file.
 */

/** Below this, the candidate is rejected and the file stays unmatched. */
const MATCH_THRESHOLD = 0.6;

/** 0–1 similarity between a parsed filename title and a catalogue title. */
export function titleSimilarity(parsed: string, candidate: string): number {
  const a = normaliseTitle(parsed);
  const b = normaliseTitle(candidate);

  if (a.length === 0 || b.length === 0) return 0;
  if (a === b) return 1;

  // Release names are often a prefix or superset of the official title.
  if (a.includes(b) || b.includes(a)) return 0.85;

  const aTokens = new Set(a.split(" "));
  const bTokens = new Set(b.split(" "));
  const shared = [...aTokens].filter((token) => bTokens.has(token)).length;

  // Jaccard over word tokens: robust to word order and minor extra words.
  return shared / (aTokens.size + bTokens.size - shared);
}

function scoreCandidate(file: LocalMediaFile, candidate: MediaItem): number {
  const parsedTitle = file.parsedTitle;
  if (!parsedTitle) return 0;

  let score = Math.max(
    titleSimilarity(parsedTitle, candidate.title),
    candidate.originalTitle ? titleSimilarity(parsedTitle, candidate.originalTitle) : 0,
  );

  // A matching year is strong corroboration; a clashing one is a mild penalty.
  if (file.parsedYear && candidate.year) {
    if (file.parsedYear === candidate.year) score += 0.1;
    else if (Math.abs(file.parsedYear - candidate.year) > 1) score -= 0.15;
  }

  // Episode-bearing files should map to series, not films.
  if (file.parsedEpisode !== null && !candidate.isSeries) score -= 0.1;

  return Math.max(0, Math.min(1, score));
}

export interface MatchResult {
  matched: number;
  unmatched: number;
  files: LocalMediaFile[];
}

/** A file with no parsed season is treated as belonging to the first. */
function seasonOf(file: LocalMediaFile): number {
  return file.parsedSeason ?? 1;
}

/**
 * The entry for a particular season of whatever was matched.
 *
 * Only AniList needs this. TMDb models a series as one entry containing all
 * its seasons, so the ref is already right; AniList files each season as a
 * separate entry, and a title search cannot tell them apart.
 *
 * Falls back to the entry that was matched when the walk cannot complete —
 * offline, or a series that does not run to that season, which usually means
 * the season was misparsed. That is no worse than the behaviour this replaces,
 * whereas refusing to match would take a playable file out of the catalogue.
 */
async function resolveSeasonRef(ref: MediaRef, season: number): Promise<MediaRef> {
  if (ref.source !== "anilist" || season <= 1) return ref;

  const sourceId = await resolveSeasonAnilistId(ref.sourceId, season);
  return sourceId === null ? ref : { ...ref, sourceId };
}

export interface MatchOptions {
  /** Re-match files that already have a `matchedRef`. */
  force?: boolean;
  /** Restrict lookups to these provider ids. */
  providerIds?: readonly string[];
}

/**
 * Match every unmatched file in the library.
 *
 * Files are grouped by parsed title so a 24-episode series costs one search
 * rather than 24 — important for rate-limited providers like AniList. The
 * search is by title alone, because season naming is far too irregular to put
 * in a query: "2", "II", "2nd Season" and "Season 2" are all in use, and some
 * seasons are titled something else entirely. The season is applied afterwards
 * by following the provider's own relation links.
 */
export async function matchLibrary(
  driver: StorageDriver,
  registry: ProviderRegistry,
  options: MatchOptions = {},
): Promise<MatchResult> {
  const { force = false, providerIds } = options;

  const files = await getLocalFiles(driver);
  const targets = files.filter(
    (file) => file.parsedTitle && (force || file.matchedRef === null),
  );

  // One lookup per distinct title.
  const byTitle = new Map<string, LocalMediaFile[]>();
  for (const file of targets) {
    const key = normaliseTitle(file.parsedTitle as string);
    if (key.length === 0) continue;
    const bucket = byTitle.get(key);
    if (bucket) bucket.push(file);
    else byTitle.set(key, [file]);
  }

  const providers = registry
    .searchable()
    // The local provider cannot match local files against themselves.
    .filter((provider) => provider.id !== "local")
    .filter((provider) => !providerIds || providerIds.includes(provider.id));

  // Title key → season number → the entry that season belongs to.
  const resolved = new Map<string, Map<number, MediaRef>>();

  for (const [key, bucket] of byTitle) {
    const sample = bucket[0];
    if (!sample?.parsedTitle) continue;

    const candidates: MediaItem[] = [];

    for (const provider of providers) {
      try {
        const result = await provider.search!(
          {
            query: sample.parsedTitle,
            sources: [],
            kinds: [],
            page: 1,
            perPage: 8,
          },
          { signal: AbortSignal.timeout(8_000), timeoutMs: 8_000 },
        );
        candidates.push(...result.items);
      } catch {
        // A provider that fails simply contributes no candidates.
      }
    }

    let best: { ref: MediaRef; score: number } | null = null;

    for (const candidate of candidates) {
      const score = scoreCandidate(sample, candidate);
      if (score >= MATCH_THRESHOLD && (!best || score > best.score)) {
        best = {
          ref: {
            source: candidate.source,
            kind: candidate.kind,
            sourceId: candidate.sourceId,
          },
          score,
        };
      }
    }

    if (!best) continue;

    /*
      The search was by title alone, so `best` is whichever season the provider
      happened to rank first — the titles differ by little more than a digit.
      Each distinct season in the bucket is now resolved to its own entry.

      Done per bucket rather than per file so a twelve-episode season costs one
      walk, and only for seasons that are actually present.
    */
    const seasons = new Map<number, MediaRef>();

    for (const season of new Set(bucket.map(seasonOf))) {
      seasons.set(season, await resolveSeasonRef(best.ref, season));
    }

    resolved.set(key, seasons);
  }

  let matched = 0;

  const updated = files.map((file) => {
    if (!file.parsedTitle) return file;
    if (!force && file.matchedRef !== null) return file;

    const ref = resolved.get(normaliseTitle(file.parsedTitle))?.get(seasonOf(file));
    if (!ref) return file;

    matched += 1;
    return { ...file, matchedRef: ref };
  });

  const saved = await saveLocalFiles(driver, updated);

  return {
    matched,
    unmatched: saved.filter((file) => file.matchedRef === null).length,
    files: saved,
  };
}
