import { useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { DiscoveryCategory } from "@vestra/extension-host";
import type { ScreenKind, ScreenSource } from "../../../../shared/screen";
import { bridge } from "@/lib/bridge";
import { ScreenFeedModel, ScreenFeedSessions } from "./screen-feed-model";

const caches = new WeakMap<QueryClient, ScreenFeedSessions>();

export function useScreenFeed(
  kind: ScreenKind,
  providers: ScreenSource[],
  query: string,
  category: DiscoveryCategory,
) {
  const key = JSON.stringify([
    kind,
    providers.map((row) => [row.id, row.revision ?? 0]),
    query,
    category,
  ]);
  const client = useQueryClient();
  const [generation, setGeneration] = useState(0);
  if (!caches.has(client)) caches.set(client, new ScreenFeedSessions());
  const cache = caches.get(client)!;
  const createModel = (refresh = false) => {
    const refreshed = new Set<string>();
    return new ScreenFeedModel(providers, (source, page) => {
      const fresh = refresh && !refreshed.has(source);
      refreshed.add(source);
      return bridge.screen.browse({
        kind,
        source,
        query,
        category,
        page,
        limit: 14,
        ...(fresh ? { refresh: true } : {}),
      });
    });
  };
  const model = useMemo(
    () => cache.get(key, () => createModel()),
    [cache, key, generation],
  );
  const refresh = () => {
    cache.get(key, () => createModel(true), true);
    setGeneration((value) => value + 1);
  };
  const results = useInfiniteQuery({
    queryKey: ["screen-batches", key, model.session],
    initialPageParam: 0,
    initialData: () => model.snapshot(),
    queryFn: ({ pageParam }) => model.read(pageParam),
    getNextPageParam: (last, _pages, index) =>
      last.hasMore ? index + 1 : undefined,
    enabled: providers.length > 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const items = useMemo(
    () => results.data?.pages.flatMap((page) => page.items) ?? [],
    [results.data],
  );
  const last = results.data?.pages.at(-1);
  const loadMore = (retryFailed = false) => {
    if (retryFailed) model.retryFailed();
    if (!results.data) {
      if (retryFailed) void results.refetch();
      return;
    }
    if (results.hasNextPage && !results.isFetching)
      void results.fetchNextPage({ cancelRefetch: false });
  };
  return {
    key,
    items,
    loadMore,
    initialPending: results.isPending,
    loading: results.isFetching,
    warnings: results.error ? [results.error.message] : (last?.warnings ?? []),
    error: results.error,
    hasMore: !!results.hasNextPage,
    capped: last?.capped ?? false,
    retry: () => loadMore(true),
    refresh,
  };
}
