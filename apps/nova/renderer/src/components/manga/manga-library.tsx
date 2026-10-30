import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  Bookmark,
  RefreshCw,
  BookOpen,
  Clock3,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { bridge } from "@/lib/bridge";
import { ReaderImages } from "@/lib/reader-images";
import { CoverLookups } from "@/lib/cover-lookups";
import { MangaDiscoveryShelf, DiscoveryCard } from "./manga-discovery";
import { MangaDetailsPage } from "./manga-details";
import type {
  MangaBook,
  MangaBookmark,
  MangaDiscoveryTitle,
  MangaRecent,
  ReadingProgress,
} from "../../../../shared/manga";

type OpenReader = (
  provider: string,
  book: MangaBook,
  onBack: () => void,
  chapter?: string,
) => ReactNode;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const grid =
  "grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6";

export function MangaLibrary({ renderReader }: { renderReader: OpenReader }) {
  const sources = useQuery({
    queryKey: ["manga", "sources"],
    queryFn: bridge.manga.sources,
    refetchInterval: (q) => (q.state.data?.length ? false : 2000),
  });
  const [params, setParams] = useSearchParams();
  const id = params.get("source") || sources.data?.[0]?.id || "";
  useEffect(() => {
    if (id && !params.has("source")) {
      const next = new URLSearchParams(params);
      next.set("source", id);
      setParams(next, { replace: true });
    }
  }, [id, params, setParams]);
  return (
    <div
      className="mx-auto max-w-[1480px] px-6 py-8 lg:px-10"
      data-manga-library
    >
      {!params.has("book") && !params.has("catalogue") && (
        <header className="mb-7 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Manga</h1>
            <p className="mt-2 text-sm text-base-content/50">
              Pick up where you left off, or find a new series.
            </p>
          </div>
          <Link
            to="/extensions"
            title="Manage manga sources"
            aria-label="Manage manga sources"
            className="btn btn-ghost btn-sm btn-square"
          >
            <SlidersHorizontal className="size-4" />
          </Link>
        </header>
      )}
      {sources.error && (
        <p role="alert" className="mb-4 text-sm">
          Could not load sources: {errorText(sources.error)}
        </p>
      )}
      {sources.isPending ? (
        <p
          role="status"
          className="py-12 text-center text-sm text-base-content/50"
        >
          Loading your sources…
        </p>
      ) : (
        <MangaShelf
          key={id}
          provider={id}
          sourceName={
            sources.data?.find((source) => source.id === id)?.name ||
            "Source unavailable"
          }
          renderReader={renderReader}
          sourceControl={
            !sources.data?.length ? (
              <Link className="btn btn-ghost m-2" to="/extensions">
                Add a manga source
              </Link>
            ) : (
              <label className="flex shrink-0 items-center gap-2 border-b border-base-content/10 px-3 py-2 sm:border-b-0 sm:border-r">
                <BookOpen className="size-4 text-base-content/45" />
                <select
                  aria-label="Manga source"
                  className="select select-ghost select-sm min-w-0 max-w-52 bg-transparent text-sm focus:outline-none"
                  value={id}
                  onChange={(event) => {
                    setParams({ source: event.target.value });
                  }}
                >
                  {id && !sources.data?.some((source) => source.id === id) && (
                    <option value={id}>Source unavailable</option>
                  )}
                  {sources.data?.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                    </option>
                  ))}
                </select>
              </label>
            )
          }
        />
      )}
    </div>
  );
}

function MangaShelf({
  provider,
  sourceControl,
  sourceName,
  renderReader,
}: {
  provider: string;
  sourceControl: ReactNode;
  sourceName: string;
  renderReader: OpenReader;
}) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(48);
  const toolbar = useRef<HTMLDivElement>(null);
  const [params, setParams] = useSearchParams();
  const [book, setBook] = useState<MangaBook | null>(null);
  const cache = useQueryClient();
  const bookId = params.get("book"),
    catalogueId = Number(params.get("catalogue") || 0);
  const reading = params.get("read") === "1";
  const pane = params.get("view") === "bookmarks" ? "bookmarks" : "browse";
  const change = (values: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values))
      if (value === null) next.delete(key);
      else next.set(key, value);
    setParams(next, { replace });
  };
  const openBook = (value: MangaBook, origin = provider) => {
    setBook(value);
    change({
      source: provider || origin,
      bookSource: origin,
      book: value.id,
      title: value.title.slice(0, 500),
      catalogue: null,
      read: null,
      chapter: null,
    });
  };
  const openCatalogue = (value: MangaDiscoveryTitle) =>
    change({
      source: provider || null,
      bookSource: null,
      catalogue: String(value.id),
      book: null,
      title: null,
      read: null,
      chapter: null,
    });
  const saved = useQuery({
    queryKey: ["manga-bookmarks"],
    queryFn: bridge.manga.bookmarks,
  });
  const bookmark = useMutation({
    mutationFn: ({
      kind,
      source,
      id,
      value,
    }: {
      kind: "source" | "catalogue";
      source: string;
      id: string;
      value: boolean;
    }) => bridge.manga.bookmark(kind, source, id, value),
    onSuccess: () => cache.invalidateQueries({ queryKey: ["manga-bookmarks"] }),
  });
  const isSaved = (kind: "source" | "catalogue", source: string, id: string) =>
    !!saved.data?.some(
      (entry) =>
        entry.kind === kind && entry.source === source && entry.book.id === id,
    );
  const saveButton = (
    kind: "source" | "catalogue",
    source: string,
    value: MangaBook,
  ) => {
    const checked = isSaved(kind, source, value.id);
    return (
      <button
        className="manga-bookmark"
        aria-label={
          checked
            ? `Remove bookmark for ${value.title}`
            : `Bookmark ${value.title}`
        }
        aria-pressed={checked}
        disabled={saved.isPending || bookmark.isPending}
        title={checked ? "Remove bookmark" : "Bookmark manga"}
        onClick={() =>
          bookmark.mutate({ kind, source, id: value.id, value: !checked })
        }
      >
        <Bookmark className="size-4" fill={checked ? "currentColor" : "none"} />
      </button>
    );
  };
  const originProvider = params.get("bookSource") || provider;
  const activeBook = useQuery({
    queryKey: [
      "manga",
      provider,
      "resolved-book",
      catalogueId || null,
      originProvider,
      bookId,
    ],
    queryFn: () =>
      bridge.manga.resolve(
        provider,
        catalogueId
          ? { kind: "catalogue", id: catalogueId }
          : {
              kind: "source",
              source: originProvider,
              id: bookId!,
              title: params.get("title") || undefined,
            },
      ),
    enabled: !!provider && (!!bookId || !!catalogueId),
    initialData:
      !catalogueId && originProvider === provider && book?.id === bookId
        ? book
        : undefined,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const [images] = useState(
    () => new ReaderImages((handle) => bridge.manga.image(handle)),
  );
  const [lookups] = useState(() => new CoverLookups());
  const lease = useRef(0);
  useEffect(() => {
    const current = ++lease.current;
    return () =>
      queueMicrotask(() => {
        if (lease.current === current) {
          images.dispose();
          lookups.dispose();
        }
      });
  }, [images, lookups]);
  const recent = useQuery({
    queryKey: ["manga", provider, "recent"],
    queryFn: () => bridge.manga.recent(provider),
    enabled: !bookId && !catalogueId && !!provider,
  });
  const results = useQuery({
    queryKey: ["manga", provider, "search", query],
    queryFn: () => bridge.manga.search(provider, query),
    enabled: !!query && !!provider,
  });
  if (bookId || catalogueId) {
    const back = () =>
      change(
        {
          book: null,
          bookSource: null,
          catalogue: null,
          title: null,
          read: null,
          chapter: null,
        },
        true,
      );
    if (reading && activeBook.data)
      return renderReader(
        provider,
        activeBook.data,
        () => change({ read: null, chapter: null }, true),
        params.get("chapter") || undefined,
      );
    const kind = bookId ? "source" : "catalogue",
      origin = bookId ? originProvider : "anilist",
      id = bookId || String(catalogueId);
    return (
      <>
        <MangaDetailsPage
          key={`${provider}:${id}`}
          provider={provider}
          sourceName={sourceName}
          images={images}
          book={activeBook.data ?? undefined}
          catalogueId={bookId ? undefined : catalogueId}
          fallbackTitle={params.get("title") || undefined}
          resolving={!!provider && activeBook.isPending}
          resolutionError={
            activeBook.error ? errorText(activeBook.error) : undefined
          }
          onRetryResolution={() => void activeBook.refetch()}
          saved={isSaved(kind, origin, id)}
          saving={saved.isPending || bookmark.isPending}
          onBookmark={() =>
            bookmark.mutate({
              kind,
              source: origin,
              id,
              value: !isSaved(kind, origin, id),
            })
          }
          onBack={back}
          onRead={(chapter) => change({ read: "1", chapter: chapter || null })}
          onSearch={(title) => {
            setInput(title);
            setQuery(title);
            setLimit(48);
            back();
          }}
        />
        {bookmark.error && (
          <p role="alert" className="manga-info">
            Bookmark could not be saved: {errorText(bookmark.error)}
          </p>
        )}
      </>
    );
  }
  const clear = () => {
    setInput("");
    setQuery("");
    void recent.refetch();
  };
  return (
    <>
      <div
        ref={toolbar}
        className="mb-8 flex flex-col overflow-hidden rounded-xl border border-base-content/10 bg-base-200/40 sm:flex-row sm:items-center"
      >
        {sourceControl}
        <form
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(input.trim());
            setLimit(48);
          }}
        >
          <Search className="size-4 shrink-0 text-base-content/40" />
          <input
            aria-label="Search manga"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-base-content/35"
            placeholder={
              provider ? "Search manga or webtoons" : "Add a source to search"
            }
            disabled={!provider}
            maxLength={500}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          {(input || query) && (
            <button
              type="button"
              className="btn btn-ghost btn-xs btn-square"
              aria-label="Clear manga search"
              onClick={clear}
            >
              <X className="size-4" />
            </button>
          )}
          <button
            className="btn btn-primary btn-sm"
            disabled={!provider || !input.trim() || results.isFetching}
          >
            Search
          </button>
        </form>
      </div>
      <div
        className="mb-5 flex gap-2"
        role="group"
        aria-label="Manga library view"
      >
        <button
          className={`btn btn-sm ${pane === "browse" ? "btn-primary" : "btn-ghost"}`}
          aria-pressed={pane === "browse"}
          onClick={() => change({ view: null })}
        >
          Browse
        </button>
        <button
          className={`btn btn-sm ${pane === "bookmarks" ? "btn-primary" : "btn-ghost"}`}
          aria-pressed={pane === "bookmarks"}
          onClick={() => change({ view: "bookmarks" })}
        >
          Bookmarks{saved.data?.length ? ` (${saved.data.length})` : ""}
        </button>
      </div>
      {(saved.error || bookmark.error) && (
        <p role="alert" className="mb-4 text-sm">
          Bookmarks could not be updated.{" "}
          <button className="link" onClick={() => void saved.refetch()}>
            Retry
          </button>
        </p>
      )}
      {pane === "bookmarks" ? (
        <section aria-label="Manga bookmarks">
          <h2 className="mb-5 text-lg font-semibold">Bookmarked manga</h2>
          {saved.isPending ? (
            <CoverSkeletons />
          ) : !saved.data?.length ? (
            <EmptyShelf
              title="Keep your next read here"
              description="Bookmark a manga from its card or information page."
            />
          ) : (
            <div className={grid}>
              {saved.data.map((entry) =>
                entry.kind === "catalogue" ? (
                  <DiscoveryCard
                    key={`catalogue:${entry.book.id}`}
                    title={{
                      id: Number(entry.book.id),
                      title: entry.book.title,
                      cover: entry.book.cover,
                      genres: [],
                      origin: null,
                      status: null,
                      score: null,
                    }}
                    images={images}
                    onSelect={() =>
                      openCatalogue({
                        id: Number(entry.book.id),
                        title: entry.book.title,
                        cover: entry.book.cover,
                        genres: [],
                        origin: null,
                        status: null,
                        score: null,
                      })
                    }
                    bookmarkControl={saveButton(
                      "catalogue",
                      "anilist",
                      entry.book,
                    )}
                  />
                ) : (
                  <MangaCard
                    key={`${entry.source}:${entry.book.id}`}
                    book={entry.book}
                    images={images}
                    provider={entry.source}
                    lookups={lookups}
                    onOpen={() => openBook(entry.book, entry.source)}
                    bookmarkControl={saveButton(
                      "source",
                      entry.source,
                      entry.book,
                    )}
                  />
                ),
              )}
            </div>
          )}
        </section>
      ) : query ? (
        <section aria-label="Manga search results">
          <div className="mb-5 flex items-baseline justify-between gap-4">
            <h2 className="min-w-0 truncate text-lg font-semibold">
              Results for “{query}”
            </h2>
            {results.data && (
              <span className="shrink-0 text-xs text-base-content/40">
                {results.data.length} titles
              </span>
            )}
          </div>
          {results.isFetching ? (
            <CoverSkeletons />
          ) : results.error ? (
            <div
              role="alert"
              className="rounded-xl border border-base-content/10 p-6 text-sm"
            >
              <p>{errorText(results.error)}</p>
              <button
                className="btn btn-sm mt-3"
                onClick={() => void results.refetch()}
              >
                Try again
              </button>
            </div>
          ) : results.data?.length === 0 ? (
            <EmptyShelf
              title="No matches this time"
              description="Try another title or select a different source."
            />
          ) : (
            <>
              <div className={grid}>
                {results.data?.slice(0, limit).map((value) => (
                  <MangaCard
                    key={value.id}
                    book={value}
                    images={images}
                    provider={provider}
                    lookups={lookups}
                    onOpen={() => openBook(value)}
                    bookmarkControl={saveButton("source", provider, value)}
                  />
                ))}
              </div>
              {(results.data?.length ?? 0) > limit && (
                <div className="mt-8 text-center">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setLimit((old) => old + 48)}
                  >
                    Show more titles
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      ) : (
        <>
          <section aria-label="Continue reading">
            <div className="mb-5 flex items-baseline justify-between gap-4">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Clock3 className="size-4 text-base-content/40" />
                Continue reading
              </h2>
              {!!recent.data?.entries.length && (
                <span className="text-xs text-base-content/40">
                  {recent.data.entries.length} recently read
                </span>
              )}
            </div>
            {recent.error && (
              <div role="alert" className="mb-5 text-sm">
                Could not load recent reading: {errorText(recent.error)}{" "}
                <button className="link" onClick={() => void recent.refetch()}>
                  Retry
                </button>
              </div>
            )}
            {!provider ? (
              <p className="text-sm text-base-content/50">
                Connect a source to start reading.
              </p>
            ) : recent.isPending ? (
              <CoverSkeletons />
            ) : recent.data?.entries.length ? (
              <div className="grid auto-cols-[132px] grid-flow-col gap-4 overflow-x-auto pb-3">
                {recent.data.entries.map((entry) => (
                  <MangaCard
                    key={entry.book.id}
                    book={entry.book}
                    progress={entry.progress}
                    images={images}
                    provider={provider}
                    lookups={lookups}
                    disabled={recent.isFetching}
                    onOpen={() => openBook(entry.book)}
                    bookmarkControl={saveButton("source", provider, entry.book)}
                  />
                ))}
              </div>
            ) : (
              !recent.error && (
                <p className="rounded-xl border border-dashed border-base-content/10 px-4 py-5 text-sm text-base-content/45">
                  No recent reading yet. Explore below, or search your source
                  above.
                </p>
              )
            )}
            {(!!recent.data?.unreadable || recent.data?.truncated) && (
              <p role="status" className="mt-5 text-xs text-base-content/50">
                Some saved entries could not be listed. Search the title to
                reopen it.
              </p>
            )}
          </section>
          <MangaDiscoveryShelf
            images={images}
            onSelect={openCatalogue}
            bookmarkControl={(title) =>
              saveButton("catalogue", "anilist", {
                id: String(title.id),
                title: title.title,
                cover: title.cover,
              })
            }
          />
        </>
      )}
    </>
  );
}

function MangaCard({
  book,
  progress,
  images,
  provider,
  lookups,
  disabled,
  onOpen,
  bookmarkControl,
}: {
  book: MangaBook;
  progress?: ReadingProgress;
  images: ReaderImages;
  provider: string;
  lookups: CoverLookups;
  disabled?: boolean;
  onOpen: () => void;
  bookmarkControl?: ReactNode;
}) {
  const [issue, setIssue] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return (
    <div className="group relative min-w-0">
      <button
        className="group block w-full min-w-0 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-base-100 disabled:opacity-60"
        aria-label={`Details for ${book.title}`}
        disabled={disabled}
        onClick={onOpen}
      >
        <div className="relative overflow-hidden rounded-xl border border-base-content/10 bg-base-200 shadow-sm transition-shadow duration-200 group-hover:shadow-xl">
          <CoverArt
            book={book}
            provider={provider}
            lookups={lookups}
            images={images}
            attempt={attempt}
            onIssue={setIssue}
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          {progress && (
            <span className="absolute bottom-3 left-3 rounded-md bg-black/65 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-md">
              Page {progress.page + 1}
            </span>
          )}
          <span className="absolute bottom-3 right-3 flex size-7 translate-y-1 items-center justify-center rounded-full bg-white/90 text-black opacity-0 transition-all group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:opacity-100">
            <ArrowUpRight className="size-4" />
          </span>
        </div>
        <h3
          className="mt-3 line-clamp-2 text-[13px] font-medium leading-snug text-base-content/85 transition-colors group-hover:text-primary"
          title={book.title}
        >
          {book.title}
        </h3>
        {progress && (
          <p className="mt-1 text-[11px] text-base-content/40">
            Last read{" "}
            {new Date(progress.updatedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </p>
        )}
      </button>
      {bookmarkControl}
      {issue && (
        <button
          className="btn btn-sm btn-square absolute right-2 top-2 z-10 bg-base-100/90"
          aria-label={`Retry cover for ${book.title}`}
          title="Retry loading cover"
          onClick={() => {
            setIssue(false);
            setAttempt((old) => old + 1);
          }}
        >
          <RefreshCw className="size-4" />
        </button>
      )}
    </div>
  );
}
function CoverArt({
  book,
  provider,
  lookups,
  images,
  attempt,
  onIssue,
}: {
  book: MangaBook;
  provider: string;
  lookups: CoverLookups;
  images: ReaderImages;
  attempt: number;
  onIssue: (issue: boolean) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const fail = useCallback(() => setFailed(true), []);
  useEffect(() => {
    if (!element.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!!entry?.isIntersecting),
      { rootMargin: "200px" },
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  const metadata = useQuery({
    queryKey: ["manga-cover-book", provider, book.id, attempt],
    queryFn: ({ signal }) =>
      lookups.run(
        () => bridge.manga.cover(provider, book.id, attempt > 0),
        signal,
      ),
    enabled: visible && (!book.cover || attempt > 0),
    staleTime: Infinity,
    gcTime: 300_000,
    retry: false,
    retryOnMount: false,
  });
  const handle = metadata.data?.cover ?? book.cover;
  const cache = useQueryClient();
  useEffect(() => {
    const resolved = metadata.data;
    if (!resolved?.cover || resolved.cover === book.cover) return;
    cache.setQueriesData<MangaBook[]>(
      { queryKey: ["manga", provider, "search"] },
      (rows) => rows?.map((row) => (row.id === book.id ? resolved : row)),
    );
    cache.setQueryData<MangaRecent>(["manga", provider, "recent"], (recent) =>
      recent
        ? {
            ...recent,
            entries: recent.entries.map((entry) =>
              entry.book.id === book.id ? { ...entry, book: resolved } : entry,
            ),
          }
        : recent,
    );
  }, [metadata.data, book.id, book.cover, provider, cache]);
  useEffect(() => setFailed(false), [handle, attempt]);
  const issue = failed || !!metadata.error || (metadata.isSuccess && !handle);
  useEffect(() => onIssue(issue), [issue, onIssue]);
  const loading =
    !issue && (!!handle || metadata.isPending || metadata.isFetching);
  return (
    <div ref={element} className="relative aspect-[2/3] overflow-hidden">
      <CoverFallback
        title={book.title}
        loading={loading}
        failed={failed || !!metadata.error}
      />
      {handle && visible && !failed && (
        <CoverImage
          key={handle}
          handle={handle}
          title={book.title}
          images={images}
          onFailed={fail}
        />
      )}
    </div>
  );
}
function CoverImage({
  handle,
  title,
  images,
  onFailed,
}: {
  handle: string;
  title: string;
  images: ReaderImages;
  onFailed: () => void;
}) {
  const cover = useQuery({
    queryKey: ["manga-cover", handle],
    queryFn: () => images.load(handle),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  useEffect(() => {
    if (cover.error) onFailed();
  }, [cover.error, onFailed]);
  if (!cover.data) return null;
  return (
    <img
      src={cover.data}
      alt={`Cover of ${title}`}
      decoding="async"
      className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]"
      onError={onFailed}
    />
  );
}
function CoverFallback({
  title,
  loading,
  failed,
}: {
  title: string;
  loading: boolean;
  failed: boolean;
}) {
  const tones = [
    "from-slate-800 via-slate-900 to-neutral-950",
    "from-stone-700 via-stone-900 to-neutral-950",
    "from-zinc-700 via-zinc-900 to-neutral-950",
  ];
  const hash = Array.from(title).reduce(
    (value, letter) => (value + letter.codePointAt(0)!) % tones.length,
    0,
  );
  return (
    <div
      aria-hidden="true"
      className={`absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-br p-5 text-center ${tones[hash]}`}
    >
      <BookOpen className="size-7 text-white/20" />
      {!loading && (
        <span className="line-clamp-3 text-lg font-medium leading-snug text-white/45">
          {title}
        </span>
      )}
      <span className="text-[10px] uppercase tracking-widest text-white/25">
        {loading
          ? "Loading cover…"
          : failed
            ? "Cover could not load"
            : "No cover available"}
      </span>
    </div>
  );
}
function EmptyShelf({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-base-content/10 px-6 py-16 text-center">
      <BookOpen className="mx-auto mb-4 size-8 text-base-content/20" />
      <h3 className="text-base font-medium">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-base-content/45">
        {description}
      </p>
      {children}
    </div>
  );
}
function CoverSkeletons() {
  return (
    <div className={grid} aria-label="Loading manga" role="status">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index}>
          <div className="aspect-[2/3] animate-pulse rounded-xl bg-base-200" />
          <div className="mt-3 h-3 w-3/4 animate-pulse rounded bg-base-200" />
        </div>
      ))}
    </div>
  );
}
