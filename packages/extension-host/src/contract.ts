import { z } from "zod";

import { streamingAccessSchema } from "@vestra/types";

/**
 * The contract between Vestra and a community extension.
 *
 * Everything here describes a boundary crossing, and the rule on both sides is
 * the same: nothing is taken on trust. Arguments in are checked because the
 * host must not hand a guest something it can exploit; results out are checked
 * because a guest returning a 400MB string, a `javascript:` URL or a cyclic
 * object should be a rejected call, not a corrupted app or a hung UI.
 *
 * Only plain JSON-representable data crosses. No functions, no prototypes, no
 * host object references — anything richer hands the guest a thread back.
 */

/**
 * SDK version extensions build against.
 *
 * Bumped when this contract changes shape. An extension declaring a newer
 * major than the host is refused rather than half-supported.
 */
export const EXTENSION_SDK_VERSION = "1.0.0";

/* =============================================================================
 * What an extension may return
 * ========================================================================== */

/** Remote images only over https — an http poster leaks and can be tampered with. */
const httpsUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => value.startsWith("https://"), "Must be an https URL");

/**
 * A search result from an extension.
 *
 * Every field is bounded. An unbounded string from an untrusted source is a
 * denial-of-service waiting to be rendered.
 */
export const extensionMediaItemSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  year: z.number().int().min(1800).max(2200).nullable().default(null),
  poster: httpsUrlSchema.nullable().default(null),
  description: z.string().max(5000).default(""),
  isSeries: z.boolean().default(false),
});

export type ExtensionMediaItem = z.infer<typeof extensionMediaItemSchema>;

/**
 * A licensed place to watch something, contributed by an extension.
 *
 * Deliberately narrower than the first-party `streamingLinkSchema`: an
 * extension supplies the service and the link, while logo, region and episode
 * title are left to the host. Those exist to be rendered as chrome, and an
 * extension supplying its own imagery is a tracking pixel with extra steps.
 *
 * This is a deep link OUT to a service the user subscribes to. It is not a
 * stream, and nothing here is playable inside Vestra — that separation is the
 * whole reason a metadata extension may carry these while stream resolution
 * lives behind a different capability entirely.
 */
export const extensionStreamingLinkSchema = z.object({
  /** Display name, e.g. "Crunchyroll". */
  service: z.string().min(1).max(120),
  url: httpsUrlSchema,
  access: streamingAccessSchema.default("unknown"),
});

export type ExtensionStreamingLink = z.infer<typeof extensionStreamingLinkSchema>;

export const extensionMediaDetailsSchema = extensionMediaItemSchema.extend({
  genres: z.array(z.string().max(60)).max(30).default([]),
  episodeCount: z.number().int().nonnegative().max(100_000).nullable().default(null),
  rating: z.number().min(0).max(100).nullable().default(null),
  /**
   * Where the title can be watched officially.
   *
   * Capped low on purpose: a title has a handful of licensees, and a list
   * longer than this is an extension padding rather than informing.
   */
  streaming: z.array(extensionStreamingLinkSchema).max(20).default([]),
});

export type ExtensionMediaDetails = z.infer<typeof extensionMediaDetailsSchema>;

/** Caps the blast radius of an extension that returns everything it has. */
export const MAX_SEARCH_RESULTS = 50;

export const searchResultsSchema = z
  .array(extensionMediaItemSchema)
  .max(MAX_SEARCH_RESULTS);

export interface ValidationOutcome<T> {
  value: T | null;
  errors: string[];
}

/**
 * Validate what an extension returned.
 *
 * Individual bad entries are dropped rather than failing the whole call: one
 * malformed result should not cost the user the other forty-nine. A result
 * that is not even an array is a refusal, since that is the extension
 * misunderstanding the contract rather than having patchy data.
 */
export function parseSearchResults(raw: unknown): ValidationOutcome<ExtensionMediaItem[]> {
  if (!Array.isArray(raw)) {
    return { value: null, errors: ["search() must return an array."] };
  }

  const value: ExtensionMediaItem[] = [];
  const errors: string[] = [];

  for (const [index, entry] of raw.slice(0, MAX_SEARCH_RESULTS).entries()) {
    const parsed = extensionMediaItemSchema.safeParse(entry);
    if (parsed.success) value.push(parsed.data);
    else errors.push(`result[${index}]: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }

  return { value, errors };
}

export function parseDetails(raw: unknown): ValidationOutcome<ExtensionMediaDetails> {
  if (raw === null || raw === undefined) return { value: null, errors: [] };

  const parsed = extensionMediaDetailsSchema.safeParse(raw);
  if (parsed.success) return { value: parsed.data, errors: [] };

  return {
    value: null,
    errors: parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "details"}: ${issue.message}`,
    ),
  };
}

/* =============================================================================
 * What an extension implements
 * ========================================================================== */

/**
 * Methods the host will call on a `custom-source` extension.
 *
 * Named rather than positional so the host can check what an extension
 * actually provides before advertising it as a source.
 */
export const CUSTOM_SOURCE_METHODS = ["search", "getDetails", "getTrending"] as const;
export type CustomSourceMethod = (typeof CUSTOM_SOURCE_METHODS)[number];

/** Required for a `custom-source` extension to be usable at all. */
export const REQUIRED_CUSTOM_SOURCE_METHODS: readonly CustomSourceMethod[] = ["search"];

export interface ActivationResult {
  /** Methods the extension exported, as reported by the runtime. */
  methods: readonly string[];
}

export function missingRequiredMethods(result: ActivationResult): CustomSourceMethod[] {
  return REQUIRED_CUSTOM_SOURCE_METHODS.filter(
    (method) => !result.methods.includes(method),
  );
}

/**
 * Whether an extension's declared SDK version is one this host can run.
 *
 * Major must match: a major bump means the contract changed in a way the
 * extension cannot be assumed to survive. A newer minor is allowed — the
 * extension may simply not use the additions.
 */
export function isSdkCompatible(declared: string, host = EXTENSION_SDK_VERSION): boolean {
  const declaredMajor = declared.split(".")[0];
  const hostMajor = host.split(".")[0];

  if (declaredMajor === undefined || hostMajor === undefined) return false;
  return declaredMajor === hostMajor;
}
