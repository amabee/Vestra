import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, BookOpen, Bookmark, ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { bridge } from "@/lib/bridge";
import type { ReaderImages } from "@/lib/reader-images";
import { chapterSequence } from "@/lib/manga-reader";
import type { MangaBook, MangaInformation } from "../../../../shared/manga";
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
  const title = book?.title || data?.title || "Manga information";
  const ordered = chapterSequence(chapters.data ?? [], "", "");
  const filtered = ordered.filter((chapter) =>
    `${chapter.title} ${chapter.chapter}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
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
      <button className="btn btn-ghost manga-info__back" onClick={props.onBack}>
        <ArrowLeft className="size-4" />
        Library
      </button>
      <div className="manga-info__hero">
        <div className="manga-info__art">
          <InformationCover
            handle={data?.cover || book?.cover}
            title={title}
            images={props.images}
          />
        </div>
        <div className="min-w-0">
          <p className="manga-info__source">
            {book ? props.sourceName : "AniList catalogue"}
          </p>
          <h1>{title}</h1>
          {!!data?.genres.length && (
            <div className="manga-info__genres">
              {data.genres.map((genre) => (
                <span key={genre}>{genre}</span>
              ))}
            </div>
          )}
          <div className="manga-info__actions">
            {book ? (
              <button
                className="btn btn-primary"
                disabled={chapters.isPending || !ordered.length}
                onClick={() => props.onRead()}
              >
                <BookOpen className="size-4" />
                {progress.data ? "Continue reading" : "Start reading"}
              </button>
            ) : props.provider ? (
              <button
                className="btn btn-primary"
                disabled={!data}
                onClick={() => data && props.onSearch(data.title)}
              >
                <BookOpen className="size-4" />
                Find in {props.sourceName}
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
          {info.isPending ? (
            <div role="status" className="manga-info__loading">
              Loading information…
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
          {data && book && (
            <p className="manga-info__notice">
              Catalogue information from AniList. Chapters are supplied by{" "}
              {props.sourceName}.
            </p>
          )}
          {catalogueId && data && !book && (
            <p className="manga-info__notice">
              Choose a matching result in your reading source to open its
              chapters.
            </p>
          )}
        </div>
      </div>
      {book && (
        <section className="manga-info__section" aria-label="Manga chapters">
          <h2>
            {chapters.data
              ? `${ordered.length} chapters available`
              : "Chapters"}
          </h2>
          {chapters.isPending ? (
            <div role="status" className="manga-info__loading">
              Loading chapters…
            </div>
          ) : chapters.error ? (
            <div role="alert" className="manga-info__error">
              Chapters could not load.{" "}
              <button
                className="btn btn-ghost"
                onClick={() => void chapters.refetch()}
              >
                Retry chapters
              </button>
            </div>
          ) : !ordered.length ? (
            <p className="manga-info__notice">
              This source has no chapters for this title.
            </p>
          ) : (
            <>
              <label className="manga-info__search">
                Find a chapter
                <input
                  value={filter}
                  placeholder="Name or number"
                  onChange={(event) => {
                    setFilter(event.target.value);
                    setLimit(50);
                  }}
                />
              </label>
              {!filtered.length ? (
                <p className="manga-info__notice">
                  No chapters match your search.
                </p>
              ) : (
                <div className="manga-info__chapters">
                  {filtered.slice(0, limit).map((chapter) => (
                    <button
                      className="manga-info__chapter"
                      key={chapter.id}
                      onClick={() => props.onRead(chapter.id)}
                      aria-label={`Open ${chapter.title || `Chapter ${chapter.chapter}`}`}
                    >
                      <span>
                        {chapter.title || `Chapter ${chapter.chapter}`}
                        <small className="block">
                          {[chapter.language, chapter.scanlator]
                            .filter(Boolean)
                            .join(", ")}
                        </small>
                      </span>
                      <ChevronRight className="size-4 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
              {filtered.length > limit && (
                <button
                  className="btn btn-ghost"
                  onClick={() => setLimit((old) => old + 50)}
                >
                  Show more chapters
                </button>
              )}
            </>
          )}
          {progress.error && (
            <p role="alert" className="manga-info__notice">
              Saved reading progress could not load.
            </p>
          )}
        </section>
      )}
    </article>
  );
}
function InformationCover({
  handle,
  title,
  images,
}: {
  handle?: string;
  title: string;
  images: ReaderImages;
}) {
  const cover = useQuery({
    queryKey: ["manga-cover", handle],
    queryFn: () => images.load(handle!),
    enabled: !!handle,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const [failed, setFailed] = useState(false);
  return cover.data && !failed ? (
    <img
      src={cover.data}
      alt={`Cover of ${title}`}
      decoding="async"
      onError={() => setFailed(true)}
    />
  ) : (
    <div
      aria-label={
        cover.error || failed ? "Cover could not load" : "Cover artwork"
      }
    >
      <BookOpen className="size-8" />
    </div>
  );
}
