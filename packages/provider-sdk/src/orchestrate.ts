import type {
  MediaItem,
  MediaKind,
  PlaybackSource,
  SearchQuery,
  SearchResponse,
  SearchResultGroup,
} from "@vestra/types";

import type { ProviderRegistry, SourceAdapterRegistry } from "./registry";
import type { MetadataProvider, ProviderContext } from "./types";

/**
 * Orchestration across registered providers.
 *
 * Every fan-out here is failure-isolated and time-boxed. A provider that hangs
 * or throws degrades its own group only — it can never stall or fail the whole
 * request. This is why `Promise.allSettled` is used throughout rather than
 * `Promise.all`, which would reject the entire search on a single bad provider.
 */

export const DEFAULT_PROVIDER_TIMEOUT_MS = 8_000;

export function toProviderMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return "This source timed out.";
    }
    return error.message;
  }
  return "This source failed.";
}

/** Build a context whose signal fires on caller abort *or* budget exhaustion. */
function createContext(options: {
  timeoutMs: number;
  revalidate?: number;
  parentSignal?: AbortSignal;
}): { context: ProviderContext; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Provider timed out", "TimeoutError")),
    options.timeoutMs,
  );

  const onParentAbort = () => controller.abort(options.parentSignal?.reason);
  options.parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  return {
    context: {
      signal: controller.signal,
      timeoutMs: options.timeoutMs,
      ...(options.revalidate === undefined ? {} : { revalidate: options.revalidate }),
    },
    dispose: () => {
      clearTimeout(timer);
      options.parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}

export interface SearchAcrossOptions {
  /** Restrict to these provider ids. Empty means every searchable provider. */
  providerIds?: readonly string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Drop groups that returned nothing and had no error. */
  pruneEmpty?: boolean;
}

/** Universal search: fan out to every searchable provider, isolate failures. */
export async function searchAcrossProviders(
  registry: ProviderRegistry,
  query: SearchQuery,
  options: SearchAcrossOptions = {},
): Promise<SearchResponse> {
  const {
    providerIds = [],
    timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
    signal,
    pruneEmpty = true,
  } = options;

  const targets = registry
    .searchable()
    .filter((provider) => providerIds.length === 0 || providerIds.includes(provider.id));

  const groups = await Promise.all(
    targets.map(async (provider): Promise<SearchResultGroup> => {
      const started = Date.now();
      const { context, dispose } = createContext({
        timeoutMs,
        ...(signal ? { parentSignal: signal } : {}),
      });

      try {
        // `capabilities.search` is validated at registration, so this exists.
        const result = await provider.search!(query, context);
        return {
          source: provider.id as SearchResultGroup["source"],
          label: provider.name,
          items: result.items,
          totalResults: result.totalResults,
          hasMore: result.hasMore,
          error: null,
          elapsedMs: Date.now() - started,
        };
      } catch (error) {
        return {
          source: provider.id as SearchResultGroup["source"],
          label: provider.name,
          items: [],
          totalResults: 0,
          hasMore: false,
          error: toProviderMessage(error),
          elapsedMs: Date.now() - started,
        };
      } finally {
        dispose();
      }
    }),
  );

  const visible = pruneEmpty
    ? groups.filter((group) => group.items.length > 0 || group.error !== null)
    : groups;

  return {
    query: query.query,
    groups: visible,
    totalResults: visible.reduce((sum, group) => sum + group.items.length, 0),
  };
}

export interface TrendingResult {
  provider: MetadataProvider;
  items: MediaItem[];
  error: string | null;
}

/** Trending for one kind, across every provider that supports it. */
export async function trendingAcrossProviders(
  registry: ProviderRegistry,
  kind: MediaKind,
  options: { timeoutMs?: number; signal?: AbortSignal; revalidate?: number } = {},
): Promise<TrendingResult[]> {
  const { timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS, signal, revalidate } = options;

  const targets = registry
    .supporting(kind)
    .filter((provider) => provider.capabilities.trending);

  return Promise.all(
    targets.map(async (provider): Promise<TrendingResult> => {
      const { context, dispose } = createContext({
        timeoutMs,
        ...(revalidate === undefined ? {} : { revalidate }),
        ...(signal ? { parentSignal: signal } : {}),
      });

      try {
        const items = await provider.getTrending!(kind, context);
        return { provider, items, error: null };
      } catch (error) {
        return { provider, items: [], error: toProviderMessage(error) };
      } finally {
        dispose();
      }
    }),
  );
}

/**
 * Collect playable sources from every adapter that claims the item,
 * best first. Adapter failures are swallowed: one broken adapter must not
 * hide the working ones.
 */
export async function resolvePlayback(
  registry: SourceAdapterRegistry,
  item: MediaItem,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<PlaybackSource[]> {
  const { timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS, signal } = options;

  const settled = await Promise.allSettled(
    registry.forItem(item).map(async (adapter) => {
      const { context, dispose } = createContext({
        timeoutMs,
        ...(signal ? { parentSignal: signal } : {}),
      });

      try {
        return await adapter.resolve(item, context);
      } finally {
        dispose();
      }
    }),
  );

  return settled
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .sort((a, b) => b.priority - a.priority);
}
