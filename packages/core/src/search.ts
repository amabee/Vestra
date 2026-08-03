import { searchAcrossProviders, type ProviderRegistry } from "@vestra/provider-sdk";
import type { MediaItem, SearchQuery, SearchResponse } from "@vestra/types";

export interface SearchDependencies {
  /** Registry supplying the providers to query. */
  providers: ProviderRegistry;
  /** Cancels the whole fan-out. */
  signal?: AbortSignal;
}

/** Ids of providers that are configured and enabled right now. */
export function getAvailableSources(providers: ProviderRegistry): string[] {
  return providers.available().map((provider) => provider.id);
}

/**
 * Universal search.
 *
 * A thin wrapper over the registry: fan-out, per-source failure isolation and
 * the timeout budget all live in `@vestra/provider-sdk`. Adding a source is a
 * registration, not an edit to this file.
 */
export async function universalSearch(
  query: SearchQuery,
  deps: SearchDependencies,
): Promise<SearchResponse> {
  return searchAcrossProviders(deps.providers, query, {
    // An empty `sources` list means "every searchable provider".
    providerIds: query.sources,
    ...(deps.signal ? { signal: deps.signal } : {}),
  });
}

/**
 * Flatten grouped results into a single ranked list for keyboard navigation.
 * Order follows provider registration, then each provider's own relevance.
 */
export function flattenSearchResults(response: SearchResponse): MediaItem[] {
  return response.groups.flatMap((group) => group.items);
}
