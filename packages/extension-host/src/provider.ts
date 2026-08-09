import type {
  MetadataProvider,
  ProviderContext,
  ProviderSearchResult,
} from "@vestra/provider-sdk";
import {
  toExtensionSource,
  type MediaDetails,
  type MediaItem,
  type MediaKind,
  type MediaRef,
  type SearchQuery,
} from "@vestra/types";

import {
  parseDetails,
  parseSearchResults,
  REQUIRED_CUSTOM_SOURCE_METHODS,
  type ExtensionMediaDetails,
  type ExtensionMediaItem,
} from "./contract";
import {
  parseAnimeResults,
  parseEpisodes,
  parseStreamResults,
  REQUIRED_STREAM_SOURCE_METHODS,
  type Anime,
  type Episode,
  type StreamResult,
} from "./stream-types";

/**
 * An installed extension, presented to the rest of the app as a provider.
 *
 * This is the socket the sandbox has been missing. Everything else was built —
 * isolates, grants, integrity, the install flow — but nothing ever called an
 * extension, so installing one changed nothing the user could see.
 *
 * The extension does not implement `MetadataProvider` itself. It answers two
 * method calls with plain data, and this turns that into the interface the
 * registry expects. Keeping the translation here means guest data is validated
 * and normalised exactly once, at the boundary, rather than by whichever
 * caller happens to receive it.
 */

/** Long enough for a slow upstream API, short enough not to hang a search. */
const CALL_TIMEOUT_MS = 10_000;

export interface ExtensionProviderOptions {
  extensionId: string;
  /** Shown as the result group heading. From the manifest, not the guest. */
  name: string;
  /** Kinds the extension declares it returns. */
  kinds: readonly MediaKind[];
  /** Methods the loaded extension actually exports. */
  methods: readonly string[];
  call: (
    method: string,
    args: readonly unknown[],
    signal: AbortSignal,
  ) => Promise<unknown>;
  /** Where validation complaints go. Guest mistakes are diagnosable, not silent. */
  onWarning?: (message: string) => void;
}

/**
 * Whether an extension exports enough to be worth registering.
 *
 * An extension that cannot search would appear in Settings as a source that
 * never returns anything, which reads as a broken app rather than an
 * incomplete extension.
 */
export function canActAsProvider(methods: readonly string[]): boolean {
  return REQUIRED_CUSTOM_SOURCE_METHODS.every((method) => methods.includes(method));
}

export function createExtensionProvider(
  options: ExtensionProviderOptions,
): MetadataProvider {
  const source = toExtensionSource(options.extensionId);
  const warn = options.onWarning ?? (() => undefined);

  const kind = (candidate: unknown): MediaKind =>
    typeof candidate === "string" && options.kinds.includes(candidate as MediaKind)
      ? (candidate as MediaKind)
      : (options.kinds[0] ?? "anime");

  /**
   * Run a guest call under a deadline.
   *
   * The isolate has its own interrupt, but that only fires while the guest is
   * executing. A guest awaiting a promise that never settles is idle, not
   * looping, and would otherwise hold a search open indefinitely.
   */
  const invoke = async (
    method: string,
    args: readonly unknown[],
    context: ProviderContext,
  ): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), context.timeoutMs ?? CALL_TIMEOUT_MS);

    const abort = () => controller.abort();
    context.signal?.addEventListener("abort", abort, { once: true });

    try {
      return await options.call(method, args, controller.signal);
    } finally {
      clearTimeout(timer);
      context.signal?.removeEventListener("abort", abort);
    }
  };

  const toItem = (entry: ExtensionMediaItem, requested: MediaKind[]): MediaItem => ({
    source,
    kind: kind(requested[0]),
    sourceId: entry.id,
    title: entry.title,
    originalTitle: null,
    year: entry.year,
    overview: entry.description.length > 0 ? entry.description : null,
    images: {
      poster: entry.poster,
      backdrop: null,
      thumbnail: null,
      placeholder: null,
    },
    rating: { score: null, votes: null },
    genres: [],
    status: "unknown",
    durationSeconds: null,
    isSeries: entry.isSeries,
    sourceUrl: null,
  });

  const toDetails = (entry: ExtensionMediaDetails, ref: MediaRef): MediaDetails => ({
    ...toItem(entry, [ref.kind]),
    kind: ref.kind,
    sourceId: ref.sourceId,
    tagline: null,
    certification: null,
    genres: entry.genres.map((name) => ({ id: name, name })),
    rating: { score: entry.rating, votes: null },
    cast: [],
    seasons: [],
    related: [],
    studios: [],
    countries: [],
    languages: [],
    streaming: [],
    external: {},
  });

  return {
    id: source,
    name: options.name,
    kinds: options.kinds,
    capabilities: {
      search: options.methods.includes("search"),
      details: options.methods.includes("getDetails"),
      trending: false,
    },
    // Extensions are desktop-only: the sandbox and the installer both need a
    // filesystem, and a thin host has none.
    requires: { filesystem: true },

    isAvailable: () => true,

    async search(
      query: SearchQuery,
      context: ProviderContext,
    ): Promise<ProviderSearchResult> {
      // Positional, matching the reference extension and the runtime tests:
      // search(query, { limit }). Changing it here would quietly break every
      // extension written against the published example.
      const raw = await invoke(
        "search",
        [query.query, { limit: query.perPage }],
        context,
      );

      const { value, errors } = parseSearchResults(raw);
      for (const error of errors) warn(`search: ${error}`);

      const items = (value ?? []).map((entry) =>
        toItem(entry, query.kinds.length > 0 ? [...query.kinds] : [...options.kinds]),
      );

      return { items, totalResults: items.length, hasMore: false };
    },

    async getDetails(
      ref: MediaRef,
      context: ProviderContext,
    ): Promise<MediaDetails | null> {
      // getDetails(id) — the id is one this extension returned from search.
      const raw = await invoke("getDetails", [ref.sourceId], context);

      const { value, errors } = parseDetails(raw);
      for (const error of errors) warn(`getDetails: ${error}`);

      return value ? toDetails(value, ref) : null;
    },
  };
}

/* =============================================================================
 * Stream sources
 * ========================================================================== */

/**
 * An extension that answers "where can this episode be played from".
 *
 * A separate capability from `MetadataProvider`, not a superset of it. The two
 * answer different questions and are trusted differently: a metadata provider
 * names a title, whereas a stream source hands a URL to a decoder. Keeping
 * them apart means a scraper cannot end up in the catalogue registry by
 * accident, and the user can be shown the difference honestly.
 *
 * Deliberately NOT registered in `createRegistries()` — a stream source is not
 * something to search the catalogue with.
 */
export interface StreamSourceProvider {
  /** `ext-<extensionId>`, the same namespacing metadata extensions get. */
  readonly id: string;
  readonly name: string;
  readonly kinds: readonly MediaKind[];

  /** Find candidate titles on this source. */
  search(
    query: string,
    options?: { limit?: number },
    context?: ProviderContext,
  ): Promise<Anime[]>;

  /** List episodes for a title id this source returned from `search`. */
  getEpisodes(animeId: string, context?: ProviderContext): Promise<Episode[]>;

  /** Resolve playable renditions for an episode id this source returned. */
  getStreams(episodeId: string, context?: ProviderContext): Promise<StreamResult[]>;
}

export interface StreamSourceProviderOptions {
  extensionId: string;
  /** From the manifest the user consented to, not from the guest. */
  name: string;
  kinds: readonly MediaKind[];
  /** Methods the loaded extension actually exports. */
  methods: readonly string[];
  call: (
    method: string,
    args: readonly unknown[],
    signal: AbortSignal,
  ) => Promise<unknown>;
  onWarning?: (message: string) => void;
}

/**
 * Whether an extension exports enough to serve as a stream source.
 *
 * All three methods are required, unlike `canActAsProvider` where `search`
 * alone is enough. A stream source exists to end at a playable URL; one that
 * can search but cannot list episodes fails only after the user has picked a
 * title, which reads as a broken app rather than a missing feature.
 */
export function canActAsStreamSource(methods: readonly string[]): boolean {
  return REQUIRED_STREAM_SOURCE_METHODS.every((method) => methods.includes(method));
}

export function createStreamSourceProvider(
  options: StreamSourceProviderOptions,
): StreamSourceProvider {
  const source = toExtensionSource(options.extensionId);
  const warn = options.onWarning ?? (() => undefined);

  /**
   * Run a guest call under a deadline.
   *
   * Same reasoning as the metadata provider's: the isolate's interrupt only
   * fires while the guest is executing, so a guest awaiting a promise that
   * never settles is idle rather than looping and would otherwise hold the
   * call open indefinitely. Resolving a stream is on the path to playback, so
   * a hang here is a spinner the user cannot escape.
   */
  const invoke = async (
    method: string,
    args: readonly unknown[],
    context: ProviderContext | undefined,
  ): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      context?.timeoutMs ?? CALL_TIMEOUT_MS,
    );

    const abort = () => controller.abort();
    context?.signal?.addEventListener("abort", abort, { once: true });

    try {
      return await options.call(method, args, controller.signal);
    } finally {
      clearTimeout(timer);
      context?.signal?.removeEventListener("abort", abort);
    }
  };

  return {
    id: source,
    name: options.name,
    kinds: options.kinds,

    async search(query, searchOptions, context): Promise<Anime[]> {
      // Positional, matching the metadata contract and the reference
      // extensions: search(query, { limit }).
      const raw = await invoke(
        "search",
        [query, { limit: searchOptions?.limit ?? 20 }],
        context,
      );

      // `provider` is stamped by the host before validation. An extension that
      // set it itself could attribute its results to another source, which is
      // the same reason the `ext-` prefix is applied here rather than trusted
      // from the manifest.
      const stamped = Array.isArray(raw)
        ? raw.map((entry) =>
            entry !== null && typeof entry === "object"
              ? { ...(entry as Record<string, unknown>), provider: source }
              : entry,
          )
        : raw;

      const { value, errors } = parseAnimeResults(stamped);
      for (const error of errors) warn(`search: ${error}`);

      return value ?? [];
    },

    async getEpisodes(animeId, context): Promise<Episode[]> {
      const raw = await invoke("getEpisodes", [animeId], context);

      const { value, errors } = parseEpisodes(raw);
      for (const error of errors) warn(`getEpisodes: ${error}`);

      return value ?? [];
    },

    async getStreams(episodeId, context): Promise<StreamResult[]> {
      const raw = await invoke("getStreams", [episodeId], context);

      const { value, errors } = parseStreamResults(raw);
      for (const error of errors) warn(`getStreams: ${error}`);

      return value ?? [];
    },
  };
}
