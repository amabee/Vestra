import type { Anime, Episode, StreamResult, SubtitleTrack, VideoSource } from "./stream-types";

/**
 * The seam between a foreign shape and Vestra's own.
 *
 * Every stream source in the world describes a video slightly differently:
 * different field names, different container labels, different places to hang
 * the headers. The alternative to converting them at the edge is letting each
 * one's vocabulary leak inward, and then every consumer downstream has to know
 * which source it is looking at.
 *
 * So this is the rule: foreign shapes stop here. Past this file the app only
 * ever sees `stream-types.ts`. That is also what makes the canonical types
 * genuinely Vestra's own rather than a copy of whoever was integrated first —
 * a format is only yours if adapting to it is someone else's job.
 *
 * Nothing in this file knows about any specific site. The mapping signatures
 * are the contract a concrete integration fills in; the helpers are the plumbing
 * that keeps every integration doing it the same way.
 */

/**
 * Convert one foreign record into a canonical one.
 *
 * Trivial by design — its value is not the implementation but the discipline:
 * a single named place where the conversion happens, so a mapping can be read,
 * diffed and tested on its own instead of being spread through a scraper.
 *
 * @example
 * const anime = adapt(raw, toAnimeFromSomeSource);
 */
export function adapt<Raw, Canonical>(
  raw: Raw,
  mapping: (raw: Raw) => Canonical,
): Canonical {
  return mapping(raw);
}

/**
 * Convert a list, discarding records the mapping rejects.
 *
 * A mapping returns `null` for a record it cannot honestly convert — a result
 * with no id, an episode with no number. Dropping those is deliberate: a
 * half-converted record surfaces to the user as a broken entry that fails only
 * when clicked, which is worse than never offering it. Compare
 * `mapRecipeRecords`, which drops junk rows for the same reason.
 */
export function adaptAll<Raw, Canonical>(
  raw: readonly Raw[],
  mapping: (raw: Raw) => Canonical | null,
): Canonical[] {
  const out: Canonical[] = [];

  for (const entry of raw) {
    const mapped = mapping(entry);
    if (mapped !== null) out.push(mapped);
  }

  return out;
}

/* =============================================================================
 * Mapping signatures
 * ========================================================================== */

/**
 * A mapping from one source's record to one canonical record.
 *
 * `null` means "this record cannot be represented" and is the correct answer
 * for missing required fields. It is not an error channel — a mapping should
 * not throw on bad input, because one unusable row is normal and should not
 * fail the other forty-nine.
 */
export type Mapping<Raw, Canonical> = (raw: Raw) => Canonical | null;

/**
 * Map a source's search result to {@link Anime}.
 *
 * Implementations must NOT populate `provider`: the host stamps it from the
 * extension id, so an extension cannot attribute results to another source.
 * Supply everything else; leave `provider` to be filled in at the boundary.
 */
export type AnimeMapping<Raw = unknown> = Mapping<Raw, Omit<Anime, "provider">>;

/**
 * Map a source's episode record to {@link Episode}.
 *
 * `number` is the label the source uses, not a position in the list. Sources
 * start at 0, repeat numbers across seasons, and use decimals for recaps, so
 * an implementation that substitutes the array index will misalign against the
 * `SxxExx` parsed from local files.
 */
export type EpisodeMapping<Raw = unknown> = Mapping<Raw, Episode>;

/** Map a source's subtitle record to {@link SubtitleTrack}. */
export type SubtitleTrackMapping<Raw = unknown> = Mapping<Raw, SubtitleTrack>;

/**
 * Map a source's rendition to {@link VideoSource}.
 *
 * The `type` field is where most conversions are needed. Vestra recognises
 * exactly two containers, `hls` and `mp4`; sources label the same two thing in
 * many ways, and some report a value meaning "we did not look". A mapping must
 * resolve to one of the two or return `null` — passing an unrecognised type
 * through reaches the player as a stall rather than a diagnosable failure.
 */
export type VideoSourceMapping<Raw = unknown> = Mapping<Raw, VideoSource>;

/**
 * Map a source's per-server response to {@link StreamResult}.
 *
 * Note the fan-out some formats require: where a source exposes "list the
 * servers" and "get one server" as separate calls, the adapter is responsible
 * for calling the second once per server and collecting the results into the
 * single array Vestra expects. That asymmetry is exactly the kind of thing
 * that belongs here rather than in the canonical contract.
 */
export type StreamResultMapping<Raw = unknown> = Mapping<Raw, StreamResult>;
