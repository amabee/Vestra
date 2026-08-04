import { useQuery } from "@tanstack/react-query";
import type { MediaKind } from "@vestra/types";

import { bridge } from "@/lib/bridge";

/**
 * Shared data hooks.
 *
 * Query keys are centralised so an invalidation after a mutation cannot drift
 * from the key the reading component used — the classic way a UI ends up
 * showing stale data with no obvious cause.
 */

export const keys = {
  diagnostics: ["diagnostics"] as const,
  settings: ["settings"] as const,
  watchlist: ["watchlist"] as const,
  history: ["history"] as const,
  progress: ["progress"] as const,
  library: ["library"] as const,
  trending: (kind: MediaKind) => ["trending", kind] as const,
  search: (query: string) => ["search", query] as const,
};

export function useWatchlist() {
  return useQuery({
    queryKey: keys.watchlist,
    queryFn: () => bridge.watchlist.list(),
    staleTime: 30_000,
  });
}

export function useHistory() {
  return useQuery({
    queryKey: keys.history,
    queryFn: () => bridge.history.list(),
  });
}

export function useLibrary() {
  return useQuery({
    queryKey: keys.library,
    queryFn: () => bridge.library.files(),
  });
}

export function useTrending(kind: MediaKind) {
  return useQuery({
    queryKey: keys.trending(kind),
    queryFn: () => bridge.media.trending(kind),
    staleTime: 5 * 60_000,
  });
}

export function useSearch(query: string) {
  return useQuery({
    queryKey: keys.search(query),
    queryFn: () => bridge.media.search(query),
    enabled: query.trim().length > 0,
  });
}

export function useDiagnostics() {
  return useQuery({
    queryKey: keys.diagnostics,
    queryFn: () => bridge.app.diagnostics(),
    staleTime: 60_000,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: () => bridge.settings.get(),
  });
}
