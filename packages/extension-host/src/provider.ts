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
