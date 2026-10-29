import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Page, PageHeader } from "@/components/layout/page";
import { bridge } from "@/lib/bridge";
import type { MangaBook, MangaPage } from "../../../shared/manga";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export function MangaRoute() {
  const sources = useQuery({
    queryKey: ["manga", "sources"],
    queryFn: bridge.manga.sources,
    refetchInterval: (q) => (q.state.data?.length ? false : 2000),
  });
  const [selected, setSelected] = useState("");
  const id = selected || sources.data?.[0]?.id || "";
  return (
    <Page>
      <PageHeader
        eyebrow="Library"
        title="Manga"
        lead="Search, read and continue where you left off."
      />
      {sources.error && <p role="alert">{errorText(sources.error)}</p>}
      {!sources.data?.length ? (
        <p className="py-8 text-base-content/60">
          No manga sources are connected. Add a manga source to start reading.
        </p>
      ) : (
        <>
          <label className="flex items-center gap-3 py-4">
            Source
            <select
              className="select select-bordered"
              value={id}
              onChange={(e) => setSelected(e.target.value)}
            >
              {sources.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <MangaBrowser key={id} provider={id} />
        </>
      )}
    </Page>
  );
}
function MangaBrowser({ provider }: { provider: string }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [book, setBook] = useState<MangaBook | null>(null);
  const results = useQuery({
    queryKey: ["manga", provider, "search", query],
    queryFn: () => bridge.manga.search(provider, query),
    enabled: query.length > 0,
  });
  if (book)
    return (
      <>
        <button className="btn btn-ghost mb-4" onClick={() => setBook(null)}>
          ← Search results
        </button>
        <BookReader key={book.id} provider={provider} book={book} />
      </>
    );
  return (
    <>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(input.trim());
        }}
      >
        <input
          aria-label="Search manga"
          className="input input-bordered flex-1"
          placeholder="Search manga titles"
          maxLength={500}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="btn btn-primary" disabled={!input.trim()}>
          Search
        </button>
      </form>
      {results.isFetching && (
        <p role="status" className="py-4">
          Searching…
        </p>
      )}
      {results.error && (
        <p role="alert" className="py-4">
          {errorText(results.error)}
        </p>
      )}
      {query && results.data?.length === 0 && (
        <p className="py-4">No matching manga found.</p>
      )}
      <div className="grid gap-2 py-5 sm:grid-cols-2">
        {results.data?.map((b) => (
          <button
            key={b.id}
            className="rounded-lg border rule p-4 text-left hover:bg-base-200"
            onClick={() => setBook(b)}
          >
            {b.title}
          </button>
        ))}
      </div>
    </>
  );
}
function BookReader({ provider, book }: { provider: string; book: MangaBook }) {
  const chapters = useQuery({
    queryKey: ["manga", provider, book.id, "chapters"],
    queryFn: () => bridge.manga.chapters(provider, book.id),
  });
  const progress = useQuery({
    queryKey: ["manga", provider, book.id, "progress"],
    queryFn: () => bridge.manga.progress(provider, book.id),
    staleTime: 0,
  });
  const [selected, setSelected] = useState("");
  const fallback =
    chapters.data?.find((c) => c.id === progress.data?.chapterId)?.id ??
    chapters.data?.[0]?.id ??
    "";
  const chapter = selected || fallback;
  return (
    <section>
      <h2 className="text-xl font-semibold">{book.title}</h2>
      {chapters.error && <p role="alert">{errorText(chapters.error)}</p>}
      {progress.error && (
        <p role="alert">
          Could not read saved progress: {errorText(progress.error)}
        </p>
      )}
      {chapters.isPending || progress.isPending ? (
        <p role="status" className="py-5">
          Loading chapters…
        </p>
      ) : chapters.data?.length ? (
        <>
          <label className="flex items-center gap-3 py-4">
            Chapter
            <select
              aria-label="Chapter"
              className="select select-bordered max-w-lg"
              value={chapter}
              onChange={(e) => setSelected(e.target.value)}
            >
              {chapters.data.map((c, i) => (
                <option key={c.id} value={c.id}>
                  {c.title || `Chapter ${c.chapter}`}{" "}
                  {c.language ? `· ${c.language}` : ""}{" "}
                  {c.scanlator ? `· ${c.scanlator}` : ""} ({i + 1}/
                  {chapters.data.length})
                </option>
              ))}
            </select>
          </label>
          <ChapterReader
            key={chapter}
            provider={provider}
            book={book.id}
            chapter={chapter}
            start={
              progress.data?.chapterId === chapter ? progress.data.page : 0
            }
          />
        </>
      ) : (
        !chapters.error && <p className="py-5">No chapters are available.</p>
      )}
    </section>
  );
}
function ChapterReader({
  provider,
  book,
  chapter,
  start,
}: {
  provider: string;
  book: string;
  chapter: string;
  start: number;
}) {
  const pages = useQuery({
    queryKey: ["manga", provider, book, chapter, "pages"],
    queryFn: () => bridge.manga.pages(provider, book, chapter),
    staleTime: 0,
  });
  if (pages.isPending) return <p role="status">Loading pages…</p>;
  if (pages.error)
    return (
      <p role="alert">
        {errorText(pages.error)}{" "}
        <button className="btn btn-sm" onClick={() => void pages.refetch()}>
          Retry
        </button>
      </p>
    );
  if (!pages.data.length) return <p>This chapter has no pages.</p>;
  return (
    <PageReader
      provider={provider}
      book={book}
      chapter={chapter}
      pages={pages.data}
      start={start}
    />
  );
}
function PageReader({
  provider,
  book,
  chapter,
  pages,
  start,
}: {
  provider: string;
  book: string;
  chapter: string;
  pages: MangaPage[];
  start: number;
}) {
  const cache = useQueryClient();
  const [page, setPage] = useState(
    Math.max(0, Math.min(start, pages.length - 1)),
  );
  const [saveError, setSaveError] = useState("");
  const handle = pages[page]!.handle;
  const image = useQuery({
    queryKey: ["manga-image", handle],
    queryFn: () => bridge.manga.image(handle),
    gcTime: 0,
    retry: false,
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.matches("input,select,textarea")) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setPage((n) => Math.min(n + 1, pages.length - 1));
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPage((n) => Math.max(n - 1, 0));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pages.length]);
  return (
    <div>
      <div className="flex items-center justify-between gap-3 py-3">
        <button
          className="btn"
          disabled={page === 0}
          onClick={() => setPage((n) => n - 1)}
        >
          Previous page
        </button>
        <span aria-live="polite">
          Page {page + 1} / {pages.length}
        </span>
        <button
          className="btn"
          disabled={page === pages.length - 1}
          onClick={() => setPage((n) => n + 1)}
        >
          Next page
        </button>
      </div>
      {saveError && (
        <p role="alert">Progress could not be saved: {saveError}</p>
      )}
      <div className="flex min-h-72 justify-center rounded-lg bg-black/30 p-2">
        {image.isPending ? (
          <p role="status" className="p-8">
            Loading page…
          </p>
        ) : image.error ? (
          <p role="alert" className="p-8">
            {errorText(image.error)}{" "}
            <button className="btn btn-sm" onClick={() => void image.refetch()}>
              Retry image
            </button>
          </p>
        ) : (
          <img
            key={handle}
            src={image.data}
            alt={`Page ${page + 1}`}
            className="max-h-[75vh] max-w-full object-contain"
            onLoad={() => {
              void bridge.manga.save(provider, book, chapter, page).then(
                () => {
                  setSaveError("");
                  cache.setQueryData(["manga", provider, book, "progress"], {
                    chapterId: chapter,
                    page,
                    updatedAt: new Date().toISOString(),
                  });
                },
                (e) => setSaveError(errorText(e)),
              );
            }}
            onError={() =>
              setSaveError(
                "The page image could not be decoded; progress was not saved.",
              )
            }
          />
        )}
      </div>
    </div>
  );
}
