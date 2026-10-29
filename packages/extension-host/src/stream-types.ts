import { z } from "zod";

/**
 * The stream-source contract: what an extension returns when it is asked
 * "where can this episode actually be played from".
 *
 * Deliberately separate from `contract.ts`. That describes a *metadata*
 * extension — "what is this thing" — and the two answer different questions
 * about different objects. Folding them together would mean one schema with
 * half its fields inapplicable at any given moment, and a registry that cannot
 * tell whether a given extension is a catalogue or a player source.
 *
 * These types are Vestra's own. Other applications describe streams
 * differently; converting their shape into this one is `adapt.ts`'s job, so
 * that everything past this boundary speaks one vocabulary. Nothing in this
 * file should ever grow a field that exists only to accommodate a particular
 * upstream format.
 *
 * As with the metadata contract, nothing here is taken on trust. A stream
 * source is, by construction, code that reads a third-party site and hands
 * the result to a media player — the least trustworthy input in the app.
 */

/* =============================================================================
 * Bounded primitives
 * ========================================================================== */

/**
 * Remote URLs must be https.
 *
 * A plaintext stream URL is observable and tamperable by anyone on the path,
 * and the thing at the other end gets handed straight to a decoder. The
 * metadata contract already holds posters to this rule; a video source is a
 * strictly larger risk than an image, so it does not get a weaker one.
 */
const httpsUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => value.startsWith("https://"), "Must be an https URL");

/**
 * Request headers a player must replay to fetch the stream.
 *
 * Hosts commonly gate their CDN on `Referer` or `Origin`, so this cannot be
 * dropped. It is bounded hard: an unbounded header map is a way to smuggle a
 * large payload, or to set a header the user would not consent to sending.
 */
const headersSchema = z
  .record(
    z.string().min(1).max(100).regex(/^[A-Za-z0-9-]+$/, "Invalid header name"),
    z.string().max(1024),
  )
  .refine((value) => Object.keys(value).length <= 16, "Too many headers (max 16)");

/* =============================================================================
 * Canonical types
 * ========================================================================== */

/**
 * A title as a stream source knows it.
 *
 * This is NOT a catalogue entry. It carries only enough to identify the title
 * on that particular source and show the user which match was picked — the
 * real metadata (synopsis, genres, ratings, artwork) comes from AniList or
 * TMDb, which is why there is no `overview` or `year` here.
 */
export const animeSchema = z.object({
  id: z.string().min(1).max(500),
  title: z.string().min(1).max(500),
  cover: httpsUrlSchema.optional(),
  /**
   * Which extension produced this.
   *
   * Set by the HOST from the extension id, never read from the guest — the
   * same rule that stops an extension claiming to be `anilist`. Present in
   * the type because consumers need it once results from several sources are
   * merged into one list.
   */
  provider: z.string().min(1).max(120),
  url: httpsUrlSchema.optional(),
});

export type Anime = z.infer<typeof animeSchema>;

export const episodeSchema = z.object({
  id: z.string().min(1).max(500),
  animeId: z.string().min(1).max(500),
  /**
   * Episode number as the source labels it.
   *
   * Not an index: sources routinely start at 0 for a prologue, or use decimals
   * for a recap. Kept as a plain number so it can be reconciled against the
   * `SxxExx` parsed from a local filename.
   */
  number: z.number().min(0).max(10_000),
  title: z.string().max(500).optional(),
  url: httpsUrlSchema.optional(),
});

export type Episode = z.infer<typeof episodeSchema>;

export const subtitleTrackSchema = z.object({
  id: z.string().min(1).max(200),
  url: httpsUrlSchema,
  /** Free text as the source gives it ("English", "en", "pt-BR"). Not normalised. */
  language: z.string().min(1).max(100),
  title: z.string().max(200).optional(),
  isDefault: z.boolean().optional(),
});

export type SubtitleTrack = z.infer<typeof subtitleTrackSchema>;

/**
 * One playable rendition.
 *
 * `type` is the container Vestra cares about, not whatever the source called
 * it. Only two matter to the player: a manifest it must follow (`hls`) or a
 * file it can open directly (`mp4`). Sources that report anything else are
 * normalised in `adapt.ts` or dropped — an unrecognised type reaching the
 * player is a hang, not an error.
 */
export const videoSourceSchema = z.object({
  url: httpsUrlSchema,
  /** Free text as labelled by the source: "1080p", "auto", "HD". */
  quality: z.string().min(1).max(60),
  type: z.enum(["hls", "mp4"]),
  headers: headersSchema.optional(),
  subtitles: z.array(subtitleTrackSchema).max(50).optional(),
});

export type VideoSource = z.infer<typeof videoSourceSchema>;

/**
 * Everything one server offers for an episode.
 *
 * Returned as a list because sources are mirrors of each other: when one is
 * down or geo-blocked the player should fall to the next rather than report
 * the episode unavailable.
 */
export const streamResultSchema = z.object({
  server: z.string().min(1).max(120),
  /** Applied to every source in this result unless a source overrides them. */
  headers: headersSchema.optional(),
  videoSources: z.array(videoSourceSchema).min(1).max(50),
});

export type StreamResult = z.infer<typeof streamResultSchema>;

/* =============================================================================
 * What a stream-source extension implements
 * ========================================================================== */

/**
 * Methods the host calls on a stream-source extension.
 *
 * Positional, matching the metadata contract and the reference extensions:
 * `search(query, { limit })`, `getEpisodes(animeId)`, `getStreams(episodeId)`.
 * The convention is load-bearing — every extension written against the
 * published examples assumes it.
 */
export const STREAM_SOURCE_METHODS = ["search", "getEpisodes", "getStreams"] as const;
export type StreamSourceMethod = (typeof STREAM_SOURCE_METHODS)[number];

/**
 * All three are required, unlike the metadata contract where `search` alone
 * is enough. A stream source exists to end at a playable URL; one missing any
 * link in that chain cannot reach it, and registering it would put a source in
 * the UI that fails only once the user has chosen an episode.
 */
export const REQUIRED_STREAM_SOURCE_METHODS: readonly StreamSourceMethod[] =
  STREAM_SOURCE_METHODS;

/** Caps what one call can return. Same reasoning as `MAX_SEARCH_RESULTS`. */
export const MAX_STREAM_SEARCH_RESULTS = 50;
export const MAX_EPISODES = 5000;
export const MAX_STREAM_RESULTS = 25;

export interface StreamValidationOutcome<T> {
  value: T | null;
  errors: string[];
}

/**
 * Validate a list from a guest.
 *
 * Bad entries are dropped individually rather than failing the call, matching
 * `parseSearchResults`: one malformed episode should not cost the user the
 * other twenty-three. A non-array is refused outright, because that is the
 * extension misunderstanding the contract rather than having patchy data.
 */
function parseList<T>(
  raw: unknown,
  schema: z.ZodType<T>,
  cap: number,
  label: string,
): StreamValidationOutcome<T[]> {
  if (!Array.isArray(raw)) {
    return { value: null, errors: [`${label}() must return an array.`] };
  }

  const value: T[] = [];
  const errors: string[] = [];

  for (const [index, entry] of raw.slice(0, cap).entries()) {
    const parsed = schema.safeParse(entry);
    if (parsed.success) value.push(parsed.data);
    else errors.push(`${label}[${index}]: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }

  return { value, errors };
}

/**
 * Validate search results.
 *
 * `provider` is stamped by the caller before validation, so an extension
 * cannot attribute its results to another source.
 */
export function parseAnimeResults(raw: unknown): StreamValidationOutcome<Anime[]> {
  return parseList(raw, animeSchema, MAX_STREAM_SEARCH_RESULTS, "search");
}

export function parseEpisodes(raw: unknown): StreamValidationOutcome<Episode[]> {
  return parseList(raw, episodeSchema, MAX_EPISODES, "getEpisodes");
}

export function parseStreamResults(raw: unknown): StreamValidationOutcome<StreamResult[]> {
  return parseList(raw, streamResultSchema, MAX_STREAM_RESULTS, "getStreams");
}
