import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { Page, PageHeader } from "@/components/layout/page";
import { bridge } from "@/lib/bridge";
import { chapterSequence } from "@/lib/manga-reader";
import { PageReader } from "@/components/manga/page-reader";
import type { MangaBook } from "../../../shared/manga";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export function MangaRoute() {
  const sources = useQuery({
    queryKey: ["manga", "sources"],
    queryFn: bridge.manga.sources,
    refetchInterval: (q) => (q.state.data?.length ? false : 2000),
  });
  const [selected, setSelected] = useState("");
  const id = sources.data?.some((source) => source.id === selected)
    ? selected
    : sources.data?.[0]?.id || "";
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
          No manga sources are connected.{" "}
          <Link className="link" to="/sources">
            Add a manga source
          </Link>{" "}
          to start reading.
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
  const recent = useQuery({
    queryKey: ["manga", provider, "recent"],
    queryFn: () => bridge.manga.recent(provider),
    enabled: book === null,
  });
  const results = useQuery({
    queryKey: ["manga", provider, "search", query],
    queryFn: () => bridge.manga.search(provider, query),
    enabled: query.length > 0,
  });
  if (book)
    return (
      <>
        <button className="btn btn-ghost mb-4" onClick={() => setBook(null)}>
          ← Browse manga
        </button>
        <BookReader key={book.id} provider={provider} book={book} />
      </>
    );
  return (
    <>
      {recent.error && (
        <p role="alert" className="py-3">
          Could not load recent reading: {errorText(recent.error)}
        </p>
      )}
      {!!recent.data?.entries.length && (
        <section className="pb-6">
          <h2 className="text-lg font-semibold">Continue reading</h2>
          <div className="grid gap-2 py-3 sm:grid-cols-2">
            {recent.data.entries.map((entry) => (
              <button
                key={entry.book.id}
                className="rounded-lg border rule p-4 text-left hover:bg-base-200"
                onClick={() => setBook(entry.book)}
              >
                <span className="block font-medium">{entry.book.title}</span>
                <span className="text-sm text-base-content/60">
                  Page {entry.progress.page + 1} ·{" "}
                  {new Date(entry.progress.updatedAt).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      {(!!recent.data?.unreadable || recent.data?.truncated) && (
        <p role="status" className="py-3 text-sm">
          Some saved reading entries could not be listed. You can still search
          for the title to open it.
        </p>
      )}
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
    staleTime: 0,
    gcTime: 0,
  });
  const progress = useQuery({
    queryKey: ["manga", provider, book.id, "progress"],
    queryFn: () => bridge.manga.progress(provider, book.id),
    staleTime: 0,
    gcTime: 0,
  });
  const [selected, setSelected] = useState("");
  const [language, setLanguage] = useState("");
  const [scanlator, setScanlator] = useState("");
  const ordered = chapterSequence(chapters.data ?? [], language, scanlator);
  const languages = [
    ...new Set(
      chapters.data?.map((c) => c.language).filter((v): v is string => !!v),
    ),
  ];
  const scanlators = [
    ...new Set(
      chapters.data?.map((c) => c.scanlator).filter((v): v is string => !!v),
    ),
  ];
  const fallback =
    ordered.find((c) => c.id === progress.data?.chapterId)?.id ??
    ordered[0]?.id ??
    "";
  const chapter = ordered.some((c) => c.id === selected) ? selected : fallback;
  const chapterIndex = ordered.findIndex((c) => c.id === chapter);
  return (
    <section>
      <h2 className="text-xl font-semibold">{book.title}</h2>
      {(languages.length > 1 || scanlators.length > 1) && (
        <div className="flex flex-wrap gap-3 py-3">
          {languages.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              Language
              <select
                className="select select-bordered select-sm"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                <option value="">All languages</option>
                {languages.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          )}
          {scanlators.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              Scanlator
              <select
                className="select select-bordered select-sm"
                value={scanlator}
                onChange={(e) => setScanlator(e.target.value)}
              >
                <option value="">All scanlators</option>
                {scanlators.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {chapters.error && <p role="alert">{errorText(chapters.error)}</p>}
      {progress.error && (
        <p role="alert">
          Could not read saved progress: {errorText(progress.error)}
        </p>
      )}
      {chapters.isPending ||
      progress.isPending ||
      chapters.isFetching ||
      progress.isFetching ? (
        <p role="status" className="py-5">
          Loading chapters…
        </p>
      ) : ordered.length ? (
        <>
          <label className="flex items-center gap-3 py-4">
            Chapter
            <select
              aria-label="Chapter"
              className="select select-bordered max-w-lg"
              value={chapter}
              onChange={(e) => setSelected(e.target.value)}
            >
              {ordered.map((c, i) => (
                <option key={c.id} value={c.id}>
                  {c.title || `Chapter ${c.chapter}`}{" "}
                  {c.language ? `· ${c.language}` : ""}{" "}
                  {c.scanlator ? `· ${c.scanlator}` : ""} ({i + 1}/
                  {ordered.length})
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-between gap-3 pb-4">
            <button
              className="btn btn-sm"
              disabled={chapterIndex <= 0}
              onClick={() => setSelected(ordered[chapterIndex - 1]!.id)}
            >
              Previous chapter
            </button>
            <button
              className="btn btn-sm"
              disabled={chapterIndex < 0 || chapterIndex === ordered.length - 1}
              onClick={() => setSelected(ordered[chapterIndex + 1]!.id)}
            >
              Next chapter
            </button>
          </div>
          <ChapterReader
            key={chapter}
            provider={provider}
            book={book.id}
            chapter={chapter}
            start={
              progress.data?.chapterId === chapter ? progress.data.page : 0
            }
            onNextChapter={
              chapterIndex >= 0 && chapterIndex < ordered.length - 1
                ? () => setSelected(ordered[chapterIndex + 1]!.id)
                : undefined
            }
          />
        </>
      ) : (
        !chapters.error && (
          <p className="py-5">No chapters match the current selection.</p>
        )
      )}
    </section>
  );
}
function ChapterReader({
  provider,
  book,
  chapter,
  start,
  onNextChapter,
}: {
  provider: string;
  book: string;
  chapter: string;
  start: number;
  onNextChapter?: () => void;
}) {
  const pages = useQuery({
    queryKey: ["manga", provider, book, chapter, "pages"],
    queryFn: () => bridge.manga.pages(provider, book, chapter),
    staleTime: Infinity,
    gcTime: 0,
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
      onNextChapter={onNextChapter}
    />
  );
}
