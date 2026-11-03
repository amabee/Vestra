import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { bridge } from "@/lib/bridge";
import type { MangaBook, MangaSearchPage } from "../../../../shared/manga";
type Source = { id: string; name: string };
type Feed = {
  data?: InfiniteData<MangaSearchPage>;
  fetching: boolean;
  more: boolean;
  error: Error | null;
  next: () => Promise<unknown>;
  retry: () => Promise<unknown>;
  refresh: () => Promise<unknown>;
};
export function nextMangaPage(last: MangaSearchPage, pages: MangaSearchPage[]) {
  if (!last.hasMore || !last.items.length) return undefined;
  const seen = new Set(
    pages.slice(0, -1).flatMap((page) => page.items.map((book) => book.id)),
  );
  if (pages.length > 1 && last.items.every((book) => seen.has(book.id)))
    return undefined;
  return last.page + 1;
}
function SourceFeed({
  source,
  query,
  onChange,
}: {
  source: Source;
  query: string;
  onChange: (id: string, feed: Feed) => void;
}) {
  const result = useInfiniteQuery({
    queryKey: ["manga", source.id, "search-pages", query],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      bridge.manga.searchPage(source.id, query, pageParam),
    getNextPageParam: nextMangaPage,
    staleTime: 300000,
    retry: false,
  });
  const feed = useMemo(
    () => ({
      data: result.data,
      fetching: result.isFetching,
      more: result.hasNextPage,
      error: result.error,
      next: () => result.fetchNextPage({ cancelRefetch: false }),
      retry: result.data ? result.fetchNextPage : result.refetch,
      refresh: result.refetch,
    }),
    [
      result.data,
      result.isFetching,
      result.hasNextPage,
      result.error,
      result.fetchNextPage,
      result.refetch,
    ],
  );
  useEffect(() => onChange(source.id, feed), [source.id, feed, onChange]);
  return null;
}
export function MangaSearchResults({
  sources,
  query,
  revision,
  renderBook,
}: {
  sources: Source[];
  query: string;
  revision: number;
  renderBook: (book: MangaBook, source: string) => ReactNode;
}) {
  const [feeds, setFeeds] = useState<Record<string, Feed>>({}),
    [visible, setVisible] = useState(48);
  const sentinel = useRef<HTMLDivElement>(null);
  const update = useCallback(
    (id: string, feed: Feed) =>
      setFeeds((old) => (old[id] === feed ? old : { ...old, [id]: feed })),
    [],
  );
  const rows = sources.flatMap((source) => {
    const seen = new Set<string>();
    return (feeds[source.id]?.data?.pages ?? [])
      .flatMap((page) => page.items)
      .filter((book) => {
        if (seen.has(book.id)) return false;
        seen.add(book.id);
        return true;
      })
      .map((book) => ({ book, source: source.id }));
  });
  const fetching = sources.some(
    (source) => !feeds[source.id] || feeds[source.id]!.fetching,
  );
  const failures = sources.filter((source) => feeds[source.id]?.error);
  const more = sources.some(
    (source) => feeds[source.id]?.more && !feeds[source.id]?.error,
  );
  const load = useCallback(() => {
    if (fetching) return;
    if (visible < rows.length) setVisible((n) => n + 48);
    else
      for (const source of sources) {
        const feed = feeds[source.id];
        if (feed?.more && !feed.error) void feed.next();
      }
  }, [feeds, fetching, rows.length, sources, visible]);
  useEffect(() => {
    const element = sentinel.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) load();
      },
      { rootMargin: "600px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [load]);
  const previous = useRef(revision);
  useEffect(() => {
    if (previous.current === revision) return;
    previous.current = revision;
    for (const feed of Object.values(feeds)) void feed.refresh();
  }, [revision, feeds]);
  return (
    <section aria-label="Manga search results">
      {sources.map((source) => (
        <SourceFeed
          key={source.id}
          source={source}
          query={query}
          onChange={update}
        />
      ))}
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h2 className="min-w-0 truncate text-lg font-semibold">
          Results for “{query}”
        </h2>
        <span className="shrink-0 text-xs text-base-content/40">
          {rows.length} loaded{fetching ? " · loading…" : ""}
        </span>
      </div>
      {!!failures.length && (
        <details className="mb-4 rounded-xl border border-base-content/10 p-3 text-sm">
          <summary>Some results could not be loaded</summary>
          {failures.map((source) => (
            <div key={source.id} className="mt-2">
              <p>
                {source.name}: {feeds[source.id]!.error!.message}
              </p>
              <button
                className="link"
                onClick={() => void feeds[source.id]!.retry()}
              >
                Retry search
              </button>
            </div>
          ))}
        </details>
      )}
      {!rows.length && !fetching && (
        <p
          role={failures.length ? "alert" : "status"}
          className="rounded-xl border border-base-content/10 p-6"
        >
          {failures.length
            ? "Search could not be completed. You can retry the failed requests above."
            : "No matches this time. Try an alternate title."}
        </p>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {rows.slice(0, visible).map((row) => (
          <div key={`${row.source}:${row.book.id}`}>
            {renderBook(row.book, row.source)}
          </div>
        ))}
      </div>
      <div ref={sentinel} data-manga-search-sentinel className="h-1" />
      {fetching ? (
        <p
          role="status"
          className="py-5 text-center text-sm text-base-content/55"
        >
          Loading manga…
        </p>
      ) : visible < rows.length || more ? (
        <button className="btn btn-ghost btn-sm mt-4" onClick={load}>
          Load more results
        </button>
      ) : rows.length > 0 ? (
        <p className="py-5 text-center text-xs text-base-content/45">
          {failures.length
            ? "More results may be available. Retry failed requests above."
            : "You’ve reached the available results."}
        </p>
      ) : null}
    </section>
  );
}
