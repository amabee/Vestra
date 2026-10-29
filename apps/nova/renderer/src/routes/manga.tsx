import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BookOpen, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { MangaLibrary } from "@/components/manga/manga-library";
import { bridge } from "@/lib/bridge";
import { chapterSequence } from "@/lib/manga-reader";
import { PageReader } from "@/components/manga/page-reader";
import { useReaderChrome } from "@/lib/use-reader-chrome";
import type { MangaBook } from "../../../shared/manga";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export function MangaRoute() {
  return (
    <MangaLibrary
      renderReader={(provider, book, onBack, chapter) => (
        <BookReader
          key={book.id}
          provider={provider}
          book={book}
          onBack={onBack}
          initialChapter={chapter}
          backLabel="Details"
        />
      )}
    />
  );
}
export function BookReader({
  provider,
  book,
  onBack,
  initialChapter,
  backLabel = "Library",
}: {
  provider: string;
  book: MangaBook;
  onBack: () => void;
  initialChapter?: string;
  backLabel?: string;
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
  const [selected, setSelected] = useState(initialChapter ?? "");
  const [language, setLanguage] = useState("");
  const [scanlator, setScanlator] = useState("");
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const chrome = useReaderChrome();
  const changeSettings = useCallback((open: boolean) => {
    setSettingsOpen(open);
    if (open) setChaptersOpen(false);
  }, []);
  useEffect(() => {
    if (chrome.immersive) {
      setChaptersOpen(false);
      setSettingsOpen(false);
    }
  }, [chrome.immersive]);
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
      onKeyDown={(event) => {
        if (event.key === "Escape") setChaptersOpen(false);
      }}
    >
      <header
        data-reader-chrome
        inert={!chrome.visible}
        className={`absolute inset-x-0 top-0 z-30 grid h-16 grid-cols-[1fr_minmax(0,2fr)_1fr] items-center gap-3 border-b rule bg-base-100/90 px-4 backdrop-blur-xl transition-opacity ${chrome.visible ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <div>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>
            ← {backLabel}
          </button>
        </div>
        <div className="min-w-0 text-center">
          <h2
            data-reader-title
            className="truncate text-sm font-semibold"
            title={book.title}
          >
            {book.title}
          </h2>
          <p className="truncate text-xs text-base-content/60">
            {ordered[chapterIndex]?.title || "Choose a chapter"}
          </p>
        </div>
        <div aria-hidden="true" />
      </header>
      {chrome.error && (
        <p role="alert" className="bg-base-100 px-4 py-2">
          {chrome.error}
        </p>
      )}
      <div className="relative flex min-h-0 flex-1">
        {chaptersOpen && (
          <aside
            id="reader-chapters"
            data-reader-chrome
            className="absolute bottom-24 right-4 z-40 flex max-h-[70vh] w-80 max-w-[calc(100%_-_2rem)] flex-col overflow-hidden rounded-xl border rule bg-base-100/95 shadow-2xl backdrop-blur-xl"
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
              <div className="mb-3 flex gap-2">
                <button
                  className="btn btn-ghost btn-sm flex-1"
                  disabled={chapterIndex <= 0}
                  aria-label="Previous chapter"
                  onClick={() => setSelected(ordered[chapterIndex - 1]!.id)}
                >
                  <ChevronLeft className="size-4" /> Previous
                </button>
                <button
                  className="btn btn-ghost btn-sm flex-1"
                  disabled={
                    chapterIndex < 0 || chapterIndex === ordered.length - 1
                  }
                  aria-label="Next chapter"
                  onClick={() => setSelected(ordered[chapterIndex + 1]!.id)}
                >
                  Next <ChevronRight className="size-4" />
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
                settingsOpen={settingsOpen}
                onSettingsChange={changeSettings}
                chapterControl={
                  <button
                    className="btn btn-ghost btn-sm max-w-44"
                    title="Choose chapter"
                    aria-label="Choose chapter"
                    aria-expanded={chaptersOpen}
                    aria-controls="reader-chapters"
                    onClick={() => {
                      setChaptersOpen(!chaptersOpen);
                      setSettingsOpen(false);
                    }}
                  >
                    <BookOpen className="size-4 shrink-0" />
                    <span className="truncate">
                      {ordered[chapterIndex]
                        ? `Ch. ${ordered[chapterIndex]!.chapter}`
                        : "Chapters"}
                    </span>
                    <ChevronUp className="size-3 shrink-0" />
                  </button>
                }
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
  settingsOpen,
  chapterControl,
}: {
  provider: string;
  book: string;
  chapter: string;
  start: number;
  onNextChapter?: () => void;
  chrome: ReturnType<typeof useReaderChrome>;
  onSettingsChange: (open: boolean) => void;
  settingsOpen: boolean;
  chapterControl: ReactNode;
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
      settingsOpen={settingsOpen}
      chapterControl={chapterControl}
    />
  );
}
