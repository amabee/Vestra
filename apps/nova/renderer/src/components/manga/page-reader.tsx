import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { bridge } from "@/lib/bridge";
import {
  adjacentPage,
  navigationKey,
  parseReaderOptions,
  readerOptionsKey,
  visiblePages,
  type ReaderOptions,
} from "@/lib/manga-reader";
import type { MangaPage } from "../../../../shared/manga";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export function PageReader({
  provider,
  book,
  chapter,
  pages,
  start,
  onNextChapter,
}: {
  provider: string;
  book: string;
  chapter: string;
  pages: MangaPage[];
  start: number;
  onNextChapter?: () => void;
}) {
  const [page, setPage] = useState(
    Math.max(0, Math.min(start, pages.length - 1)),
  );
  const [options, setOptions] = useState<ReaderOptions>(() => {
    try {
      return parseReaderOptions(localStorage.getItem(readerOptionsKey));
    } catch {
      return parseReaderOptions(null);
    }
  });
  const [optionsError, setOptionsError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(readerOptionsKey, JSON.stringify(options));
      setOptionsError("");
    } catch {
      setOptionsError(
        "Reader settings could not be remembered on this device.",
      );
    }
  }, [options]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
        return;
      }
      if (
        event.defaultPrevented ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (event.target instanceof Element &&
          event.target.closest(
            "input,select,textarea,[contenteditable]:not([contenteditable=false]),[role=textbox]",
          ))
      )
        return;
      const step = navigationKey(event.key, options.direction);
      if (step) {
        event.preventDefault();
        setPage((n) => adjacentPage(n, pages.length, step, options));
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        setPage(event.key === "Home" ? 0 : pages.length - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pages.length, options]);
  const visible = visiblePages(page, pages.length, options);
  const first = visible[0]!;
  const last = visible[visible.length - 1]!;
  const displayed = visible.map((index) => ({
    ...pages[index]!,
    ordinal: index,
  }));
  const patch = (value: Partial<ReaderOptions>) =>
    setOptions((old) => ({ ...old, ...value }));
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {settingsOpen && (
        <aside
          aria-label="Reader settings"
          className="absolute bottom-16 right-3 top-3 z-20 w-72 max-w-[calc(100%_-_1.5rem)] overflow-y-auto rounded-xl border rule bg-base-100 p-4 text-sm shadow-2xl"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Reader settings</h3>
            <button
              className="btn btn-ghost btn-xs"
              aria-label="Close reader settings"
              onClick={() => setSettingsOpen(false)}
            >
              ✕
            </button>
          </div>
          <div className="grid gap-4 pt-4">
            <label className="grid gap-1">
              Layout
              <select
                className="select select-bordered select-sm"
                value={options.layout}
                onChange={(e) =>
                  patch({ layout: e.target.value as ReaderOptions["layout"] })
                }
              >
                <option value="single">Single page</option>
                <option value="double">Double page</option>
              </select>
            </label>
            <label className="grid gap-1">
              Reading direction
              <select
                className="select select-bordered select-sm"
                value={options.direction}
                onChange={(e) =>
                  patch({
                    direction: e.target.value as ReaderOptions["direction"],
                  })
                }
              >
                <option value="ltr">Left to right</option>
                <option value="rtl">Right to left</option>
              </select>
            </label>
            <label className="grid gap-1">
              Fit
              <select
                className="select select-bordered select-sm"
                value={options.fit}
                onChange={(e) =>
                  patch({ fit: e.target.value as ReaderOptions["fit"] })
                }
              >
                <option value="height">Fit height</option>
                <option value="width">Fit width</option>
              </select>
            </label>
            <label className="grid gap-1">
              Zoom
              <select
                className="select select-bordered select-sm"
                value={options.zoom}
                onChange={(e) => patch({ zoom: Number(e.target.value) })}
              >
                {[
                  50,
                  75,
                  100,
                  125,
                  150,
                  200,
                  ...(![50, 75, 100, 125, 150, 200].includes(options.zoom)
                    ? [options.zoom]
                    : []),
                ]
                  .sort((a, b) => a - b)
                  .map((zoom) => (
                    <option key={zoom} value={zoom}>
                      {zoom}%
                    </option>
                  ))}
              </select>
            </label>
            {options.layout === "double" && (
              <label className="flex items-center gap-2 py-2">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={options.firstPageAlone}
                  onChange={(e) => patch({ firstPageAlone: e.target.checked })}
                />
                First page alone
              </label>
            )}
          </div>
        </aside>
      )}
      {optionsError && (
        <p role="alert" className="py-2">
          {optionsError}
        </p>
      )}
      <SpreadView
        key={displayed.map((p) => p.handle).join(":")}
        provider={provider}
        book={book}
        chapter={chapter}
        pages={displayed}
        options={options}
      />
      <div className="h-0.5 shrink-0 bg-base-300" aria-hidden="true">
        <div
          className="h-full bg-primary transition-[width]"
          style={{ width: `${((last + 1) / pages.length) * 100}%` }}
        />
      </div>
      <footer
        className="flex min-h-14 shrink-0 flex-wrap items-center justify-center gap-3 border-t rule bg-base-100 px-3 py-2 text-sm"
        style={{
          flexDirection: options.direction === "rtl" ? "row-reverse" : "row",
        }}
      >
        <button
          className="btn btn-ghost btn-sm"
          disabled={first === 0}
          onClick={() =>
            setPage((n) => adjacentPage(n, pages.length, -1, options))
          }
        >
          ← Previous
        </button>
        <span aria-live="polite">
          {visible.length > 1
            ? `Pages ${first + 1}–${last + 1}`
            : `Page ${first + 1}`}{" "}
          / {pages.length}
        </span>
        <label className="flex items-center gap-2 text-sm">
          Page
          <input
            aria-label="Go to page"
            className="input input-bordered input-sm w-20"
            type="number"
            min={1}
            max={pages.length}
            value={page + 1}
            onChange={(e) => {
              const n = e.target.valueAsNumber;
              if (Number.isInteger(n) && n >= 1 && n <= pages.length)
                setPage(n - 1);
            }}
          />
        </label>
        <button
          className="btn btn-ghost btn-sm"
          disabled={last === pages.length - 1 && !onNextChapter}
          onClick={() =>
            last === pages.length - 1
              ? onNextChapter?.()
              : setPage((n) => adjacentPage(n, pages.length, 1, options))
          }
        >
          {last === pages.length - 1
            ? onNextChapter
              ? "Next chapter →"
              : "Chapter complete"
            : "Next →"}
        </button>
        <button
          className="btn btn-sm"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen(!settingsOpen)}
        >
          Settings
        </button>
      </footer>
    </div>
  );
}

function SpreadView({
  provider,
  book,
  chapter,
  pages,
  options,
}: {
  provider: string;
  book: string;
  chapter: string;
  pages: (MangaPage & { ordinal: number })[];
  options: ReaderOptions;
}) {
  const cache = useQueryClient();
  const [decoded, setDecoded] = useState<string[]>([]);
  const [saveError, setSaveError] = useState("");
  const [saveAttempt, setSaveAttempt] = useState(0);
  const canvas = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);
  const ready = pages.every((p) => decoded.includes(p.handle));
  const anchor = pages[0]!.ordinal;
  useEffect(() => {
    if (!ready) return;
    let active = true;
    void bridge.manga.save(provider, book, chapter, anchor).then(
      () => {
        if (active) setSaveError("");
        cache.setQueryData(["manga", provider, book, "progress"], {
          chapterId: chapter,
          page: anchor,
          updatedAt: new Date().toISOString(),
        });
        void cache.invalidateQueries({
          queryKey: ["manga", provider, "recent"],
        });
      },
      (error) => {
        if (active) setSaveError(errorText(error));
      },
    );
    return () => {
      active = false;
    };
  }, [ready, provider, book, chapter, anchor, cache, saveAttempt]);
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-neutral-950 text-neutral-200">
      {saveError && (
        <p role="alert" className="py-2">
          Progress could not be saved: {saveError}{" "}
          <button
            className="btn btn-sm"
            onClick={() => setSaveAttempt((n) => n + 1)}
          >
            Retry saving
          </button>
        </p>
      )}
      <div ref={canvas} className="min-h-0 flex-1 overflow-auto p-2">
        <div
          className="mx-auto flex min-h-full items-start justify-center gap-2"
          style={{
            width: `${options.zoom}%`,
            flexDirection: options.direction === "rtl" ? "row-reverse" : "row",
          }}
        >
          {pages.map((page) => (
            <PageImage
              key={page.handle}
              page={page}
              options={options}
              height={height}
              onDecoded={() =>
                setDecoded((old) =>
                  old.includes(page.handle) ? old : [...old, page.handle],
                )
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PageImage({
  page,
  options,
  height,
  onDecoded,
}: {
  page: MangaPage & { ordinal: number };
  options: ReaderOptions;
  height: number;
  onDecoded: () => void;
}) {
  const image = useQuery({
    queryKey: ["manga-image", page.handle],
    queryFn: () => bridge.manga.image(page.handle),
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
  });
  const [decodeError, setDecodeError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return (
    <div className="flex min-w-0 flex-1 justify-center">
      {image.isPending || image.isFetching ? (
        <p role="status" className="p-8">
          Loading page {page.ordinal + 1}…
        </p>
      ) : image.error || decodeError ? (
        <div role="alert" className="p-6">
          <p>
            {decodeError
              ? "This image could not be decoded. Reading progress was not advanced."
              : errorText(image.error)}
          </p>
          <button
            className="btn btn-sm mt-3"
            onClick={() => {
              setDecodeError(false);
              setAttempt((n) => n + 1);
              void image.refetch();
            }}
          >
            Retry image
          </button>
        </div>
      ) : (
        <img
          key={attempt}
          src={image.data}
          alt={`Page ${page.ordinal + 1}`}
          className="max-w-full object-contain"
          style={
            options.fit === "height"
              ? {
                  maxHeight: height
                    ? `${(Math.max(1, height - 16) * options.zoom) / 100}px`
                    : "100%",
                }
              : { width: "100%", height: "auto" }
          }
          onLoad={onDecoded}
          onError={() => setDecodeError(true)}
        />
      )}
    </div>
  );
}
