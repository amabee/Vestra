import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  Star,
  X,
} from "lucide-react";
import { bridge } from "@/lib/bridge";
import type { ReaderImages } from "@/lib/reader-images";
import type {
  MangaDiscoveryPage,
  MangaDiscoveryQuery,
  MangaDiscoveryTitle,
} from "../../../../shared/manga";

const defaults: MangaDiscoveryQuery = {
  sort: "popular",
  origin: "all",
  genre: "",
  status: "all",
  page: 1,
};
const headings = {
  popular: "Popular manga",
  trending: "Trending now",
  score: "Top rated",
  newest: "Newest releases",
};
export function MangaDiscoveryShelf({
  images,
  onSelect,
  bookmarkControl,
}: {
  images: ReaderImages;
  onSelect: (title: MangaDiscoveryTitle) => void;
  bookmarkControl: (title: MangaDiscoveryTitle) => ReactNode;
}) {
  const [filters, setFilters] = useState(defaults);
  const [requested, setRequested] = useState(defaults);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => setRequested(filters), 180);
    return () => clearTimeout(timer);
  }, [filters]);
  const changing = requested !== filters;
  const knownGenres = useRef<string[]>([]);
  const catalogue = useQuery({
    queryKey: ["manga-discovery", requested],
    queryFn: () => bridge.manga.discover(requested),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
  });
  useEffect(() => {
    if (catalogue.data) knownGenres.current = catalogue.data.genres;
  }, [catalogue.data]);
  const patch = (value: Partial<MangaDiscoveryQuery>) =>
    setFilters((old) => ({ ...old, ...value, page: 1 }));
  const filtered =
    filters.origin !== "all" ||
    !!filters.genre ||
    filters.status !== "all" ||
    filters.sort !== "popular";
  return (
    <section
      ref={section}
      className="mt-10 border-t border-base-content/10 pt-7"
      aria-label="Discover manga"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{headings[filters.sort]}</h2>
          <p className="mt-1 text-xs text-base-content/45">
            AniList catalogue · select a title to search your manga source.
          </p>
        </div>
        <button
          className="btn btn-ghost btn-sm btn-square"
          aria-label="Refresh manga discovery"
          title="Refresh catalogue"
          disabled={catalogue.isFetching || changing}
          onClick={() => void catalogue.refetch()}
        >
          <RefreshCw
            className={`size-4 ${catalogue.isFetching ? "animate-spin" : ""}`}
          />
        </button>
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <select
          className="select select-bordered select-sm w-auto"
          aria-label="Catalogue sort"
          value={filters.sort}
          onChange={(event) =>
            patch({ sort: event.target.value as MangaDiscoveryQuery["sort"] })
          }
        >
          <option value="popular">Popular</option>
          <option value="trending">Trending</option>
          <option value="score">Top rated</option>
          <option value="newest">Newest</option>
        </select>
        <select
          className="select select-bordered select-sm w-auto"
          aria-label="Manga origin"
          value={filters.origin}
          onChange={(event) =>
            patch({
              origin: event.target.value as MangaDiscoveryQuery["origin"],
            })
          }
        >
          <option value="all">All origins</option>
          <option value="JP">Manga · Japan</option>
          <option value="KR">Manhwa · Korea</option>
          <option value="CN">Manhua · China</option>
        </select>
        <select
          className="select select-bordered select-sm w-auto"
          aria-label="Manga genre"
          value={filters.genre}
          onChange={(event) => patch({ genre: event.target.value })}
        >
          <option value="">All genres</option>
          {(catalogue.data?.genres ?? knownGenres.current).map((genre) => (
            <option key={genre} value={genre}>
              {genre}
            </option>
          ))}
        </select>
        <select
          className="select select-bordered select-sm w-auto"
          aria-label="Manga publication status"
          value={filters.status}
          onChange={(event) =>
            patch({
              status: event.target.value as MangaDiscoveryQuery["status"],
            })
          }
        >
          <option value="all">Any status</option>
          <option value="RELEASING">Ongoing</option>
          <option value="FINISHED">Completed</option>
        </select>
        {filtered && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setFilters(defaults)}
          >
            <X className="size-3" />
            Reset
          </button>
        )}
      </div>
      {catalogue.data?.stale && (
        <p role="status" className="mb-4 text-xs text-base-content/50">
          Showing a saved catalogue while AniList is unavailable.
        </p>
      )}
      {catalogue.isPending || changing ? (
        <div
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6"
          role="status"
          aria-label="Loading discovery"
        >
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="aspect-[2/3] animate-pulse rounded-xl bg-base-200"
            />
          ))}
        </div>
      ) : catalogue.error ? (
        <div
          role="alert"
          className="rounded-xl border border-base-content/10 p-6 text-sm"
        >
          <p>
            {catalogue.error instanceof Error
              ? catalogue.error.message
              : "Could not load the catalogue."}
          </p>
          <button
            className="btn btn-sm mt-3"
            onClick={() => void catalogue.refetch()}
          >
            Try again
          </button>
        </div>
      ) : !catalogue.data?.items.length ? (
        <p className="rounded-xl border border-dashed border-base-content/10 px-6 py-12 text-center text-sm text-base-content/50">
          No titles match these filters. Try another genre or origin.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {catalogue.data.items.map((title) => (
              <DiscoveryCard
                key={title.id}
                title={title}
                images={images}
                onSelect={() => onSelect(title)}
                bookmarkControl={bookmarkControl(title)}
              />
            ))}
          </div>
          <div className="mt-7 flex items-center justify-center gap-4">
            <button
              className="btn btn-ghost btn-sm"
              disabled={filters.page === 1 || catalogue.isFetching}
              onClick={() => {
                setFilters((old) => ({ ...old, page: old.page - 1 }));
                section.current?.scrollIntoView({ block: "start" });
              }}
            >
              <ChevronLeft className="size-4" />
              Previous
            </button>
            <span className="text-xs tabular-nums text-base-content/50">
              Page {filters.page}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              disabled={
                !catalogue.data.hasNextPage ||
                filters.page >= 100 ||
                catalogue.isFetching
              }
              onClick={() => {
                setFilters((old) => ({ ...old, page: old.page + 1 }));
                section.current?.scrollIntoView({ block: "start" });
              }}
            >
              Next
              <ChevronRight className="size-4" />
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export function DiscoveryCard({
  title,
  images,
  onSelect,
  bookmarkControl,
}: {
  title: MangaDiscoveryTitle;
  images: ReaderImages;
  onSelect: () => void;
  bookmarkControl?: ReactNode;
}) {
  const [issue, setIssue] = useState(false),
    [retrying, setRetrying] = useState(false);
  const [handle, setHandle] = useState(title.cover);
  const cache = useQueryClient();
  useEffect(() => {
    setHandle(title.cover);
    setIssue(false);
  }, [title.cover]);
  const retry = async () => {
    setRetrying(true);
    try {
      const cover = await bridge.manga.catalogueCover(title.id);
      setHandle(cover);
      setIssue(false);
      cache.setQueriesData<MangaDiscoveryPage>(
        { queryKey: ["manga-discovery"] },
        (data) =>
          data
            ? {
                ...data,
                items: data.items.map((row) =>
                  row.id === title.id ? { ...row, cover } : row,
                ),
              }
            : data,
      );
    } catch {
      setIssue(true);
    } finally {
      setRetrying(false);
    }
  };
  return (
    <div className="group relative min-w-0">
      <button
        className="block w-full min-w-0 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-base-100"
        aria-label={`Details for ${title.title}`}
        onClick={onSelect}
      >
        <div className="relative overflow-hidden rounded-xl border border-base-content/10 bg-base-200">
          <DiscoveryCover
            key={handle}
            title={title.title}
            handle={handle}
            images={images}
            onIssue={setIssue}
          />
          <span className="absolute bottom-3 left-3 rounded-md bg-black/65 px-2 py-1 text-[10px] text-white backdrop-blur">
            {title.origin === "KR"
              ? "Manhwa"
              : title.origin === "CN"
                ? "Manhua"
                : "Manga"}
          </span>
          <span className="absolute bottom-3 right-3 flex size-7 items-center justify-center rounded-full bg-white/90 text-black opacity-0 transition-opacity group-hover:opacity-100">
            <Search className="size-3.5" />
          </span>
        </div>
        <h3
          className="mt-3 line-clamp-2 text-[13px] font-medium leading-snug text-base-content/85 group-hover:text-primary"
          title={title.title}
        >
          {title.title}
        </h3>
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-base-content/40">
          <span className="truncate">
            {title.genres.slice(0, 2).join(" · ")}
          </span>
          {title.score !== null && (
            <span className="flex shrink-0 items-center gap-1">
              <Star className="size-3 text-amber-400/70" />
              {(title.score / 10).toFixed(1)}
            </span>
          )}
        </div>
      </button>
      {bookmarkControl}
      {issue && (
        <button
          className="btn btn-sm btn-square absolute right-2 top-2 bg-base-100/90"
          aria-label={`Retry discovery cover for ${title.title}`}
          title="Retry cover"
          disabled={retrying}
          onClick={() => void retry()}
        >
          <RefreshCw className={`size-4 ${retrying ? "animate-spin" : ""}`} />
        </button>
      )}
    </div>
  );
}
function DiscoveryCover({
  title,
  handle,
  images,
  onIssue,
}: {
  title: string;
  handle?: string;
  images: ReaderImages;
  onIssue: (issue: boolean) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!element.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!!entry?.isIntersecting),
      { rootMargin: "300px" },
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  const cover = useQuery({
    queryKey: ["manga-cover", handle],
    queryFn: () => images.load(handle!),
    enabled: !!handle && visible,
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
  });
  const issue = failed || !!cover.error;
  useEffect(() => onIssue(issue), [issue, onIssue]);
  return (
    <div
      ref={element}
      className="relative aspect-[2/3] overflow-hidden bg-gradient-to-br from-slate-800 to-neutral-950"
    >
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center"
        aria-hidden="true"
      >
        <BookOpen className="size-7 text-white/20" />
        <span className="text-xs text-white/30">
          {issue
            ? "Cover could not load"
            : handle
              ? "Loading cover…"
              : "No cover available"}
        </span>
      </div>
      {cover.data && !failed && (
        <img
          src={cover.data}
          alt={`Cover of ${title}`}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
