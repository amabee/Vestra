import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { Page, PageHeader } from "@/components/layout/page";
import { bridge } from "@/lib/bridge";
import { chapterSequence } from "@/lib/manga-reader";
import { PageReader } from "@/components/manga/page-reader";
import { useReaderChrome } from "@/lib/use-reader-chrome";
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
      <BookReader
        key={book.id}
        provider={provider}
        book={book}
        onBack={() => setBook(null)}
      />
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
export function BookReader({
  provider,
  book,
  onBack,
}: {
  provider: string;
  book: MangaBook;
  onBack: () => void;
}) {
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
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const chrome = useReaderChrome(chaptersOpen || settingsOpen);
  const [filter, setFilter] = useState("");
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
    <section
      ref={chrome.root}
      aria-label="Manga reader"
      className={`fixed inset-x-0 bottom-0 z-40 flex flex-col overflow-hidden bg-neutral-950 ${chrome.fullscreen ? "top-0" : "top-11"}`}
      onPointerMove={chrome.wake}
      onPointerDown={chrome.wake}
      onFocusCapture={(event) =>
        chrome.setFocused(
          event.target.matches(":focus-visible") &&
            !!event.target.closest("[data-reader-chrome]"),
        )
      }
      onBlurCapture={(event) => {
        if (
          !(event.relatedTarget instanceof Element) ||
          !event.relatedTarget.closest("[data-reader-chrome]")
        )
          chrome.setFocused(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setChaptersOpen(false);
      }}
    >
      <header
        data-reader-chrome
        inert={!chrome.visible}
        className={`z-30 flex h-16 shrink-0 items-center gap-3 border-b rule bg-base-100/95 px-4 backdrop-blur-xl transition-opacity ${chrome.immersive ? "absolute inset-x-0 top-0" : ""} ${chrome.visible ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          ← Library
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold" title={book.title}>
            {book.title}
          </h2>
          <p className="truncate text-xs text-base-content/60">
            {ordered[chapterIndex]?.title ||
              (ordered[chapterIndex]
                ? `Chapter ${ordered[chapterIndex]!.chapter}`
                : "Choose a chapter")}
          </p>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          disabled={chapterIndex <= 0}
          onClick={() => setSelected(ordered[chapterIndex - 1]!.id)}
          aria-label="Previous chapter"
        >
          ← Chapter
        </button>
        <button
          className="btn btn-ghost btn-sm"
          disabled={chapterIndex < 0 || chapterIndex === ordered.length - 1}
          onClick={() => setSelected(ordered[chapterIndex + 1]!.id)}
          aria-label="Next chapter"
        >
          Chapter →
        </button>
        <button
          className="btn btn-sm"
          aria-expanded={chaptersOpen}
          aria-controls="reader-chapters"
          onClick={() => setChaptersOpen(!chaptersOpen)}
        >
          Chapters
        </button>
      </header>
      {chrome.error && (
        <p role="alert" className="bg-base-100 px-4 py-2">
          {chrome.error}
        </p>
      )}
      <div
        className={`relative flex min-h-0 flex-1 ${chrome.immersive && (chaptersOpen || settingsOpen) ? "pt-16" : ""}`}
      >
        {chaptersOpen && (
          <aside
            id="reader-chapters"
            data-reader-chrome
            className="absolute inset-y-0 left-0 z-30 flex w-80 max-w-full flex-col border-r rule bg-base-100 shadow-2xl sm:static sm:shrink-0"
          >
            <div className="border-b rule p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">
                  Chapters{" "}
                  <span className="text-base-content/50">{ordered.length}</span>
                </h3>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => setChaptersOpen(false)}
                  aria-label="Close chapters"
                >
                  ✕
                </button>
              </div>
              <input
                className="input input-bordered input-sm w-full"
                aria-label="Find chapter"
                placeholder="Find chapter…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
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
            </div>
            <nav
              aria-label="Chapters"
              className="min-h-0 flex-1 overflow-y-auto p-2"
            >
              {ordered
                .filter((c) =>
                  `${c.title} ${c.chapter}`
                    .toLowerCase()
                    .includes(filter.toLowerCase()),
                )
                .map((c) => (
                  <button
                    key={c.id}
                    aria-current={c.id === chapter ? "true" : undefined}
                    className={`mb-1 block w-full rounded-lg p-3 text-left text-sm ${c.id === chapter ? "bg-primary/15 text-primary" : "hover:bg-base-200"}`}
                    onClick={() => {
                      setSelected(c.id);
                      setChaptersOpen(false);
                    }}
                  >
                    <span className="block">
                      {c.title || `Chapter ${c.chapter}`}
                    </span>
                    <span className="text-xs opacity-60">
                      {[c.language, c.scanlator].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                ))}
            </nav>
          </aside>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
                chrome={chrome}
                onSettingsChange={setSettingsOpen}
              />
            </>
          ) : (
            !chapters.error && (
              <p className="py-5">No chapters match the current selection.</p>
            )
          )}
        </div>
      </div>
    </section>
  );
}
function ChapterReader({
  provider,
  book,
  chapter,
  start,
  onNextChapter,
  chrome,
  onSettingsChange,
}: {
  provider: string;
  book: string;
  chapter: string;
  start: number;
  onNextChapter?: () => void;
  chrome: ReturnType<typeof useReaderChrome>;
  onSettingsChange: (open: boolean) => void;
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
      chrome={chrome}
      onSettingsChange={onSettingsChange}
    />
  );
}
