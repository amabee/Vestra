import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  ChevronRight,
  Search,
  ListFilter,
  RefreshCw,
} from "lucide-react";
import { Link } from "react-router";
import { bridge } from "@/lib/bridge";
import type { ReaderImages } from "@/lib/reader-images";
import { chapterSequence } from "@/lib/manga-reader";
import type { MangaBook } from "../../../../shared/manga";
import "./manga-details.css";

type Shared = {
  provider: string;
  sourceName: string;
  images: ReaderImages;
  saved: boolean;
  saving: boolean;
  onBookmark: () => void;
  onBack: () => void;
  onRead: (chapter?: string) => void;
  onSearch: (title: string) => void;
  fallbackTitle?: string;
  resolving: boolean;
  resolutionError?: string;
  onRetryResolution: () => void;
};
export function MangaDetailsPage({
  book,
  catalogueId,
  ...props
}: Shared & { book?: MangaBook; catalogueId?: number }) {
  const info = useQuery({
    queryKey: catalogueId
      ? ["manga-info", catalogueId]
      : ["manga-info", props.provider, book?.id],
    queryFn: () =>
      catalogueId
        ? bridge.manga.details(catalogueId)
        : bridge.manga.info(props.provider, book!.id),
    enabled: !!catalogueId || !!book,
    staleTime: 60 * 60_000,
    retry: false,
  });
  const chapters = useQuery({
    queryKey: ["manga", props.provider, book?.id, "chapters"],
    queryFn: () => bridge.manga.chapters(props.provider, book!.id),
    enabled: !!book,
    staleTime: 30_000,
    retry: false,
  });
  const progress = useQuery({
    queryKey: ["manga", props.provider, book?.id, "progress"],
    queryFn: () => bridge.manga.progress(props.provider, book!.id),
    enabled: !!book,
    retry: false,
  });
  const [filter, setFilter] = useState("");
  const [limit, setLimit] = useState(50);
  const data = info.data;
  const title =
    data?.title || book?.title || props.fallbackTitle || "Manga information";
  const [newest, setNewest] = useState(false);
  const artwork = useQuery({
    queryKey: ["manga", props.provider, book?.id, "details-cover"],
    queryFn: () => bridge.manga.cover(props.provider, book!.id, false),
    enabled: !!book,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const ordered = chapterSequence(chapters.data ?? [], "", "");
  const filtered = ordered.filter((chapter) =>
    `${chapter.title} ${chapter.chapter}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const displayChapters = newest ? [...filtered].reverse() : filtered;
  const facts: [string, string][] = [];
  if (data?.status)
    facts.push(["Status", data.status.replaceAll("_", " ").toLowerCase()]);
  if (data?.year) facts.push(["Year", String(data.year)]);
  if (data?.score != null)
    facts.push(["Rating", `${(data.score / 10).toFixed(1)} / 10`]);
  if (data?.chapters != null)
    facts.push(["Catalogue chapters", String(data.chapters)]);
  if (data?.volumes != null) facts.push(["Volumes", String(data.volumes)]);
  return (
    <article className="manga-info" data-manga-details>
      <nav className="manga-info__nav" aria-label="Manga navigation">
        <button
          className="btn btn-ghost manga-info__back"
          onClick={props.onBack}
        >
          <ArrowLeft className="size-4" />
          Library
        </button>
        <span className="manga-info__provider">
          <BookOpen className="size-4" />
          {props.provider ? props.sourceName : "No reading source selected"}
        </span>
      </nav>
      <div className="manga-info__layout">
        <aside
          className="manga-info__publication"
          aria-label="Cover and publication"
        >
          <div className="manga-info__art">
            <InformationCover
              key={artwork.data?.cover || book?.cover || data?.cover || "empty"}
              handle={artwork.data?.cover || book?.cover || data?.cover}
              fallback={data?.cover}
              title={title}
              images={props.images}
              refresh={async () =>
                book
                  ? (await bridge.manga.cover(props.provider, book.id, true))
                      .cover
                  : data
                    ? bridge.manga.catalogueCover(data.id)
                    : undefined
              }
            />
          </div>
          {!!facts.length && (
            <dl className="manga-info__facts">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {info.isPending && (!!catalogueId || !!book) && (
            <div className="manga-info__skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          )}
        </aside>
        <div className="manga-info__content">
          <header className="manga-info__heading">
            <h1>{title}</h1>
            {!!data?.genres.length && (
              <div className="manga-info__genres">
                {data.genres.map((genre) => (
                  <span key={genre}>{genre}</span>
                ))}
              </div>
            )}
            <div className="manga-info__actions">
              {props.provider ? (
                <button
                  className="btn btn-primary"
                  disabled={
                    !book ||
                    chapters.isPending ||
                    !ordered.length ||
                    !!progress.error ||
                    progress.isPending
                  }
                  onClick={() => props.onRead()}
                >
                  <BookOpen className="size-4" />
                  {progress.data ? "Continue reading" : "Start reading"}
                </button>
              ) : (
                <Link className="btn btn-primary" to="/sources">
                  Add a reading source
                </Link>
              )}
              <button
                className="btn btn-ghost"
                aria-label={
                  props.saved
                    ? `Remove bookmark for ${title}`
                    : `Bookmark ${title}`
                }
                aria-pressed={props.saved}
                disabled={props.saving || (!book && !data)}
                onClick={props.onBookmark}
              >
                <Bookmark
                  className="size-4"
                  fill={props.saved ? "currentColor" : "none"}
                />
                {props.saving
                  ? "Saving…"
                  : props.saved
                    ? "Bookmarked"
                    : "Bookmark"}
              </button>
            </div>
          </header>
          <section className="manga-info__about" aria-label="Manga synopsis">
            {info.isPending && (!!catalogueId || !!book) ? (
              <div role="status" className="manga-info__skeleton">
                <span className="sr-only">Loading information…</span>
                <i />
                <i />
                <i />
              </div>
            ) : info.error ? (
              <div role="alert" className="manga-info__notice">
                Catalogue information could not load.{" "}
                <button
                  className="btn btn-ghost"
                  onClick={() => void info.refetch()}
                >
                  Retry information
                </button>
              </div>
            ) : data?.description ? (
              <p className="manga-info__synopsis">{data.description}</p>
            ) : (
              <p className="manga-info__notice">
                A synopsis is not available for this title.
              </p>
            )}
            {data && (
              <p className="manga-info__credit">
                Publication information from AniList
              </p>
            )}
          </section>
          <section
            className="manga-info__section"
            aria-label="Manga chapters"
            aria-busy={props.resolving || (!!book && chapters.isPending)}
          >
            <div className="manga-info__section-head">
              <h2>Chapters</h2>
              {book && chapters.data && <span>{ordered.length} available</span>}
            </div>
            {props.resolving || (book && chapters.isPending) ? (
              <div role="status" className="manga-info__chapter-skeleton">
                <p>
                  {props.resolving
                    ? `Finding this manga in ${props.sourceName}…`
                    : "Loading chapters…"}
                </p>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} />
                ))}
              </div>
            ) : props.resolutionError ? (
              <div role="alert" className="manga-info__state">
                <h3>Manga could not be matched</h3>
                <p>{props.resolutionError}</p>
                <button
                  className="btn btn-ghost"
                  onClick={props.onRetryResolution}
                >
                  <RefreshCw className="size-4" />
                  Retry matching
                </button>
              </div>
            ) : !props.provider ? (
              <div className="manga-info__state">
                <h3>Add a source to see chapters</h3>
                <p>Choose a reading source in your library.</p>
                <Link className="btn btn-ghost" to="/sources">
                  Manage sources
                </Link>
              </div>
            ) : !book ? (
              <div className="manga-info__state">
                <h3>No matching manga in {props.sourceName}</h3>
                <p>No unique title match was found in the selected source.</p>
                <button
                  className="btn btn-ghost"
                  onClick={props.onRetryResolution}
                >
                  Retry matching
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => props.onSearch(title)}
                >
                  Search this source
                </button>
              </div>
            ) : chapters.error ? (
              <div role="alert" className="manga-info__state">
                <h3>Chapters could not load</h3>
                <p>The selected source could not return its chapter list.</p>
                <button
                  className="btn btn-ghost"
                  onClick={() => void chapters.refetch()}
                >
                  Retry chapters
                </button>
              </div>
            ) : !ordered.length ? (
              <div className="manga-info__state">
                <h3>No chapters available</h3>
                <p>This source has no chapters for this title yet.</p>
                <button
                  className="btn btn-ghost"
                  onClick={() => void chapters.refetch()}
                >
                  Refresh chapters
                </button>
              </div>
            ) : (
              <>
                <div className="manga-info__tools">
                  <label className="manga-info__field manga-info__field--search">
                    <span>Find a chapter</span>
                    <span className="manga-info__search">
                      <Search className="size-4" />
                      <input
                        value={filter}
                        placeholder="Find a chapter"
                        onChange={(event) => {
                          setFilter(event.target.value);
                          setLimit(50);
                        }}
                      />
                    </span>
                  </label>
                  <label className="manga-info__field">
                    <span>Chapter order</span>
                    <span className="manga-info__sort">
                      <ListFilter className="size-4" />
                      <select
                        aria-label="Chapter order"
                        value={newest ? "newest" : "oldest"}
                        onChange={(event) => {
                          setNewest(event.target.value === "newest");
                          setLimit(50);
                        }}
                      >
                        <option value="oldest">Oldest first</option>
                        <option value="newest">Newest first</option>
                      </select>
                    </span>
                  </label>
                </div>
                {!filtered.length ? (
                  <div className="manga-info__state">
                    <p>No chapters match your search.</p>
                    <button
                      className="btn btn-ghost"
                      onClick={() => setFilter("")}
                    >
                      Clear chapter search
                    </button>
                  </div>
                ) : (
                  <div className="manga-info__chapters">
                    {displayChapters.slice(0, limit).map((chapter) => (
                      <button
                        className="manga-info__chapter"
                        key={chapter.id}
                        onClick={() => props.onRead(chapter.id)}
                        aria-label={`Open ${chapter.title || `Chapter ${chapter.chapter}`}`}
                      >
                        <span className="manga-info__number">
                          {chapter.chapter || String(chapter.index + 1)}
                        </span>
                        <span className="manga-info__chapter-name">
                          <span>
                            {chapter.title || `Chapter ${chapter.chapter}`}
                          </span>
                          {(chapter.language || chapter.scanlator) && (
                            <small>
                              {[chapter.language, chapter.scanlator]
                                .filter(Boolean)
                                .join(", ")}
                            </small>
                          )}
                        </span>
                        {progress.data?.chapterId === chapter.id && (
                          <span className="manga-info__resume">Continue</span>
                        )}
                        <ChevronRight className="size-4 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
                {filtered.length > limit && (
                  <button
                    className="btn btn-ghost manga-info__more"
                    onClick={() => setLimit((old) => old + 50)}
                  >
                    Show more chapters
                  </button>
                )}
              </>
            )}
            {progress.error && book && (
              <p role="alert" className="manga-info__notice">
                Saved reading progress could not load.{" "}
                <button
                  className="btn btn-ghost"
                  onClick={() => void progress.refetch()}
                >
                  Retry progress
                </button>
              </p>
            )}
          </section>
        </div>
      </div>
    </article>
  );
}

function InformationCover({
  handle,
  fallback,
  title,
  images,
  refresh,
}: {
  handle?: string;
  fallback?: string;
  title: string;
  images: ReaderImages;
  refresh: () => Promise<string | undefined>;
}) {
  const [override, setOverride] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const active = override || handle;
  const cover = useQuery({
    queryKey: ["manga-cover", active],
    queryFn: async () => {
      try {
        return await images.load(active!);
      } catch (error) {
        if (fallback && fallback !== active) return images.load(fallback);
        throw error;
      }
    },
    enabled: !!active,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  return cover.data && !failed ? (
    <img
      src={cover.data}
      alt={`Cover of ${title}`}
      decoding="async"
      onError={() => {
        if (fallback && fallback !== active) setOverride(fallback);
        else setFailed(true);
      }}
    />
  ) : (
    <div
      className="manga-info__placeholder"
      aria-label={
        cover.error || failed ? "Cover could not load" : "Cover artwork"
      }
    >
      <BookOpen className="size-8" />
      <span>
        {cover.isFetching || retrying ? "Loading cover…" : "Cover unavailable"}
      </span>
      {(cover.error || failed) && (
        <button
          className="btn btn-ghost"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            try {
              const fresh = await refresh();
              if (fresh) {
                setOverride(fresh);
                setFailed(false);
                if (fresh === active) void cover.refetch();
              }
            } catch {
              setFailed(true);
            } finally {
              setRetrying(false);
            }
          }}
        >
          Retry cover
        </button>
      )}
    </div>
  );
}
