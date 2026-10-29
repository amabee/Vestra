import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  EyeOff,
  Maximize,
  Minimize,
  Settings,
} from "lucide-react";
import { ReaderImages } from "@/lib/reader-images";
import { ReaderProgress } from "./reader-progress";
import { bridge } from "@/lib/bridge";
import {
  adjacentPage,
  isVerticalLayout,
  navigationKey,
  parseReaderOptions,
  readerOptionsKey,
  recommendLayout,
  seriesOptionsKey,
  visiblePages,
  type ReaderOptions,
} from "@/lib/manga-reader";
import { editableTarget, type useReaderChrome } from "@/lib/use-reader-chrome";
import type { MangaPage } from "../../../../shared/manga";

const ImagesContext = createContext<ReaderImages | null>(null);
type Chrome = ReturnType<typeof useReaderChrome>;
type Dimensions = { width: number; height: number };
type PositionedPage = MangaPage & { ordinal: number };
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function PageReader({
  provider,
  book,
  chapter,
  pages,
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
  pages: MangaPage[];
  start: number;
  onNextChapter?: () => void;
  chrome: Chrome;
  onSettingsChange: (open: boolean) => void;
  settingsOpen: boolean;
  chapterControl: ReactNode;
}) {
  const [page, setPage] = useState(
    Math.max(0, Math.min(start, pages.length - 1)),
  );
  const [jump, setJump] = useState({ page, serial: 0 });
  const [options, setOptions] = useState<ReaderOptions>(() => {
    try {
      return parseReaderOptions(
        localStorage.getItem(seriesOptionsKey(provider, book)) ??
          localStorage.getItem(readerOptionsKey),
      );
    } catch {
      return parseReaderOptions(null);
    }
  });
  const [optionsError, setOptionsError] = useState("");
  const setSettingsOpen = onSettingsChange;
  const [images] = useState(
    () => new ReaderImages((handle) => bridge.manga.image(handle)),
  );
  const imageLease = useRef(0);
  useEffect(() => {
    const lease = ++imageLease.current;
    return () =>
      queueMicrotask(() => {
        // React development StrictMode immediately sets the effect up again.
        if (imageLease.current === lease) images.dispose();
      });
  }, [images]);
  const previousPosition = useRef(page);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const pointerStart = useRef({ x: 0, y: 0 });
  useEffect(() => () => clearTimeout(clickTimer.current), []);
  const [decoded, setDecoded] = useState<Set<number>>(() => new Set());
  const [recommendation, setRecommendation] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = content.current;
    if (!element) return;
    const zoom = (event: WheelEvent) => {
      if (
        !event.ctrlKey ||
        (event.target instanceof Element &&
          event.target.closest("aside,footer"))
      )
        return;
      event.preventDefault();
      setOptions((old) => ({
        ...old,
        zoom: Math.max(
          50,
          Math.min(200, old.zoom + (event.deltaY < 0 ? 5 : -5)),
        ),
      }));
    };
    element.addEventListener("wheel", zoom, { passive: false });
    return () => element.removeEventListener("wheel", zoom);
  }, []);
  const vertical = isVerticalLayout(options.layout);
  const go = useCallback(
    (position: number) => {
      const next = Math.max(0, Math.min(position, pages.length - 1));
      setPage(next);
      setJump((old) => ({ page: next, serial: old.serial + 1 }));
    },
    [pages.length],
  );
  const patch = (value: Partial<ReaderOptions>) => {
    setOptions((old) => ({ ...old, ...value }));
    setJump((old) => ({ page, serial: old.serial + 1 }));
  };
  useEffect(() => {
    try {
      localStorage.setItem(
        seriesOptionsKey(provider, book),
        JSON.stringify(options),
      );
      setOptionsError("");
    } catch {
      setOptionsError(
        "Reader settings could not be remembered for this series.",
      );
    }
  }, [options, provider, book]);
  const visible = visiblePages(page, pages.length, options);
  const first = visible[0]!;
  const last = visible[visible.length - 1]!;
  const ready = visible.every((index) => decoded.has(index));
  const progress = useReadingProgress(provider, book, chapter, first, ready);
  const onDecoded = useCallback((index: number, size: Dimensions) => {
    setDecoded((old) => (old.has(index) ? old : new Set([...old, index])));
    if (recommendLayout(size.width, size.height) === "webtoon")
      setRecommendation(true);
  }, []);
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
        editableTarget(event.target)
      )
        return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        setSettingsOpen(!settingsOpen);
        chrome.wake();
        return;
      }
      // Space on a focused button keeps its native activation behavior.
      if (
        event.key === " " &&
        event.target instanceof Element &&
        event.target.closest("button,a")
      )
        return;
      if (event.key === " " && vertical) {
        event.preventDefault();
        const canvas = content.current?.querySelector<HTMLElement>(
          '[aria-label="Vertical manga pages"]',
        );
        if (canvas)
          canvas.scrollBy({
            top: canvas.clientHeight * 0.85,
            behavior: "smooth",
          });
        return;
      }
      const step =
        event.key === " " ? 1 : navigationKey(event.key, options.direction);
      if (step) {
        event.preventDefault();
        go(adjacentPage(page, pages.length, step, options));
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        go(event.key === "Home" ? 0 : pages.length - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    page,
    pages.length,
    options,
    vertical,
    go,
    chrome.wake,
    settingsOpen,
    setSettingsOpen,
  ]);
  useEffect(() => {
    const direction = page < previousPosition.current ? -1 : 1;
    previousPosition.current = page;
    const offsets = [1, 2, 3, 4, 5, 6, -1, -2];
    images.prefetch(
      offsets
        .map((offset) => pages[page + offset * direction]?.handle)
        .filter((value): value is string => !!value),
    );
  }, [page, pages, images]);
  const positioned = pages.map((value, ordinal) => ({ ...value, ordinal }));
  return (
    <ImagesContext.Provider value={images}>
      <div
        ref={content}
        className="relative flex min-h-0 flex-1 flex-col bg-neutral-950 text-neutral-200"
        onPointerDown={(event) => {
          pointerStart.current = { x: event.clientX, y: event.clientY };
        }}
        onClick={(event) => {
          if (
            !(event.target instanceof Element) ||
            !event.target.closest("[data-reader-canvas]") ||
            event.target.closest("button,input,select,a") ||
            window.getSelection()?.toString()
          )
            return;
          if (
            Math.hypot(
              event.clientX - pointerStart.current.x,
              event.clientY - pointerStart.current.y,
            ) > 6
          )
            return;
          clearTimeout(clickTimer.current);
          if (event.detail < 2)
            clickTimer.current = setTimeout(chrome.toggleControls, 200);
        }}
        onDoubleClick={(event) => {
          clearTimeout(clickTimer.current);
          if (
            !(event.target instanceof Element) ||
            !event.target.closest("button,input,select,aside,footer")
          )
            patch({ zoom: 100 });
        }}
      >
        {settingsOpen && (
          <aside
            aria-label="Reader settings"
            className="absolute bottom-24 right-4 top-20 z-40 w-80 max-w-[calc(100%_-_1.5rem)] overflow-y-auto rounded-xl border border-white/15 bg-neutral-900/95 p-4 text-sm shadow-2xl backdrop-blur-xl"
            data-reader-chrome
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
            <p className="mt-1 text-xs text-neutral-400">
              Remembered separately for this series.
            </p>
            <div className="grid gap-4 pt-4">
              <label className="grid gap-1">
                Layout
                <select
                  className="select select-bordered select-sm w-full"
                  value={options.layout}
                  onChange={(e) =>
                    patch({ layout: e.target.value as ReaderOptions["layout"] })
                  }
                >
                  <option value="single">Single page</option>
                  <option value="double">Double page</option>
                  <option value="continuous">Long strip / continuous</option>
                  <option value="webtoon">Webtoon · gapless vertical</option>
                </select>
              </label>
              <label className="grid gap-1">
                Reading direction
                <select
                  className="select select-bordered select-sm w-full"
                  value={options.direction}
                  onChange={(e) =>
                    patch({
                      direction: e.target.value as ReaderOptions["direction"],
                    })
                  }
                >
                  <option value="ltr">Left to right →</option>
                  <option value="rtl">← Right to left</option>
                </select>
                <span className="text-xs text-neutral-400">
                  {vertical
                    ? "Vertical reading stays top to bottom."
                    : options.direction === "rtl"
                      ? "← Next page · Previous page →"
                      : "← Previous page · Next page →"}
                </span>
              </label>
              <label className="grid gap-1">
                Image fitting
                <select
                  className="select select-bordered select-sm w-full"
                  disabled={vertical}
                  value={options.fit}
                  onChange={(e) =>
                    patch({ fit: e.target.value as ReaderOptions["fit"] })
                  }
                >
                  <option value="height">Fit height</option>
                  <option value="width">Fit width</option>
                  <option value="page">Fit page</option>
                  <option value="original">Original size</option>
                </select>
                {vertical && (
                  <span className="text-xs text-neutral-400">
                    Vertical layouts use the strip width. Adjust it with zoom.
                  </span>
                )}
              </label>
              <label className="grid gap-2">
                Zoom · {options.zoom}%
                <input
                  className="range range-xs"
                  aria-label="Reader zoom"
                  type="range"
                  min={50}
                  max={200}
                  step={5}
                  value={options.zoom}
                  onChange={(e) => patch({ zoom: Number(e.target.value) })}
                />
              </label>
              {options.layout === "double" && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={options.firstPageAlone}
                    onChange={(e) =>
                      patch({ firstPageAlone: e.target.checked })
                    }
                  />
                  First page alone
                </label>
              )}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={chrome.immersive}
                  onChange={(e) => chrome.setImmersive(e.target.checked)}
                />
                Hide controls until the next page click
              </label>
              <p className="text-xs leading-relaxed text-neutral-400">
                ← / → pages · Space next page (scroll in vertical layouts) · F
                fullscreen · S settings · I immersive · Esc close overlays
                <br />
                Click page to hide/show controls · Ctrl + wheel zoom ·
                Double-click to reset zoom
              </p>
            </div>
          </aside>
        )}
        {optionsError && (
          <p role="alert" className="px-4 py-2 text-sm">
            {optionsError}
          </p>
        )}
        {progress.error && (
          <p role="alert" className="px-4 py-2 text-sm">
            Progress could not be saved: {progress.error}{" "}
            <button className="btn btn-sm" onClick={progress.retry}>
              Retry saving
            </button>
          </p>
        )}
        {recommendation && !dismissed && !vertical && chrome.visible && (
          <div
            className="absolute left-3 top-20 z-10 max-w-sm rounded-lg border border-white/15 bg-neutral-900/95 p-3 text-sm"
            data-reader-chrome
          >
            This chapter has tall pages. Try Webtoon mode?
            <div className="mt-2 flex gap-2">
              <button
                className="btn btn-primary btn-xs"
                onClick={() => {
                  patch({ layout: "webtoon" });
                  setDismissed(true);
                }}
              >
                Use Webtoon
              </button>
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => setDismissed(true)}
              >
                Keep current layout
              </button>
            </div>
          </div>
        )}
        {vertical ? (
          <ContinuousView
            key={options.layout}
            pages={positioned}
            options={options}
            jump={jump}
            onPosition={setPage}
            onDecoded={onDecoded}
          />
        ) : (
          <SpreadView
            key={visible.join(":")}
            pages={visible.map((index) => positioned[index]!)}
            options={options}
            onDecoded={onDecoded}
          />
        )}
        <footer
          data-reader-chrome
          inert={!chrome.visible}
          className={`absolute inset-x-0 bottom-0 z-30 border-t border-white/10 bg-neutral-900/95 px-4 py-3 text-sm backdrop-blur-xl transition-opacity ${chrome.visible ? "opacity-100" : "pointer-events-none opacity-0"}`}
        >
          <ReaderProgress
            pages={pages}
            page={first}
            images={images}
            onChange={go}
          />
          <div className="grid grid-cols-1 items-center gap-2 lg:grid-cols-[1fr_auto_1fr]">
            <div className="hidden lg:block" aria-hidden="true" />
            <div
              data-reader-pagination
              className="flex items-center justify-center gap-3"
              style={{
                flexDirection:
                  options.direction === "rtl" ? "row-reverse" : "row",
              }}
            >
              <button
                className="btn btn-ghost btn-sm btn-square"
                title="Previous page"
                aria-label="Previous page"
                disabled={first === 0}
                onClick={() =>
                  go(adjacentPage(page, pages.length, -1, options))
                }
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="min-w-32 text-center tabular-nums">
                {visible.length > 1 ? `${first + 1}–${last + 1}` : first + 1} /{" "}
                {pages.length} ·{" "}
                {(((last + 1) / pages.length) * 100).toFixed(1)}%
              </span>
              <button
                className="btn btn-ghost btn-sm btn-square"
                title={
                  last === pages.length - 1
                    ? onNextChapter
                      ? "Next chapter"
                      : "Chapter complete"
                    : "Next page"
                }
                aria-label={
                  last === pages.length - 1 && onNextChapter
                    ? "Next chapter"
                    : "Next page"
                }
                disabled={last === pages.length - 1 && !onNextChapter}
                onClick={() =>
                  last === pages.length - 1
                    ? onNextChapter?.()
                    : go(adjacentPage(page, pages.length, 1, options))
                }
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
            <div
              data-reader-actions
              className="flex items-center justify-end gap-1"
            >
              <button
                className="btn btn-ghost btn-sm btn-square"
                title="Settings (S)"
                aria-label="Reader settings"
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen(!settingsOpen)}
              >
                <Settings className="size-4" />
              </button>
              <button
                className="btn btn-ghost btn-sm btn-square"
                title="Hide controls (I) · click page to reveal"
                aria-label="Immersive reading"
                aria-pressed={chrome.immersive}
                onClick={chrome.toggleControls}
              >
                <EyeOff className="size-4" />
              </button>
              <button
                className="btn btn-ghost btn-sm btn-square"
                title={
                  chrome.fullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"
                }
                aria-label={
                  chrome.fullscreen ? "Exit fullscreen" : "Fullscreen"
                }
                onClick={() => void chrome.toggleFullscreen()}
              >
                {chrome.fullscreen ? (
                  <Minimize className="size-4" />
                ) : (
                  <Maximize className="size-4" />
                )}
              </button>
              {chapterControl}
            </div>
          </div>
        </footer>
      </div>
    </ImagesContext.Provider>
  );
}

function useReadingProgress(
  provider: string,
  book: string,
  chapter: string,
  page: number,
  ready: boolean,
) {
  const cache = useQueryClient();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    void bridge.manga.save(provider, book, chapter, page).then(
      () => {
        if (active) setError("");
        cache.setQueryData(["manga", provider, book, "progress"], {
          chapterId: chapter,
          page,
          updatedAt: new Date().toISOString(),
        });
        void cache.invalidateQueries({
          queryKey: ["manga", provider, "recent"],
        });
      },
      (failure) => {
        if (active) setError(errorText(failure));
      },
    );
    return () => {
      active = false;
    };
  }, [provider, book, chapter, page, ready, cache, attempt]);
  return { error, retry: () => setAttempt((old) => old + 1) };
}

function SpreadView({
  pages,
  options,
  onDecoded,
}: {
  pages: PositionedPage[];
  options: ReaderOptions;
  onDecoded: (index: number, size: Dimensions) => void;
}) {
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
  return (
    <div
      ref={canvas}
      className="min-h-0 flex-1 overflow-auto p-2"
      tabIndex={0}
      aria-label="Manga pages"
      data-reader-canvas
    >
      <div
        className="mx-auto flex min-h-full items-start justify-center gap-2"
        style={{
          width: `${options.zoom}%`,
          flexDirection: options.direction === "rtl" ? "row-reverse" : "row",
        }}
      >
        {pages.map((page) => (
          <div
            key={page.handle}
            className={`flex min-w-0 justify-center ${options.fit === "original" ? "shrink-0" : "flex-1"}`}
          >
            <PageImage
              page={page}
              options={options}
              height={height}
              onDecoded={(size) => onDecoded(page.ordinal, size)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function ContinuousView({
  pages,
  options,
  jump,
  onPosition,
  onDecoded,
}: {
  pages: PositionedPage[];
  options: ReaderOptions;
  jump: { page: number; serial: number };
  onPosition: (page: number) => void;
  onDecoded: (index: number, size: Dimensions) => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const slots = useRef(new Map<number, HTMLDivElement>());
  const pending = useRef<number | null>(jump.page);
  const [target, setTarget] = useState<number | null>(jump.page);
  const [nearby, setNearby] = useState<Set<number>>(() => new Set([jump.page]));
  const sizes = useRef(new Map<number, Dimensions>());
  const observer = useRef<IntersectionObserver | null>(null);
  const frame = useRef(0);
  useEffect(() => {
    const interrupt = (event: KeyboardEvent) => {
      if (
        !editableTarget(event.target) &&
        [" ", "PageDown", "PageUp", "ArrowDown", "ArrowUp"].includes(event.key)
      ) {
        pending.current = null;
        setTarget(null);
      }
    };
    window.addEventListener("keydown", interrupt);
    return () => window.removeEventListener("keydown", interrupt);
  }, []);
  const register = useCallback(
    (index: number, element: HTMLDivElement | null) => {
      const prior = slots.current.get(index);
      if (prior) observer.current?.unobserve(prior);
      if (element) {
        slots.current.set(index, element);
        observer.current?.observe(element);
      } else slots.current.delete(index);
    },
    [],
  );
  const identify = useCallback(() => {
    const root = canvas.current;
    if (!root || pending.current !== null) return;
    const line =
      root.getBoundingClientRect().top + Math.min(120, root.clientHeight * 0.2);
    let best = 0;
    for (const [index, element] of slots.current) {
      if (element.getBoundingClientRect().top <= line) best = index;
      else break;
    }
    onPosition(best);
  }, [onPosition]);
  useEffect(() => {
    const root = canvas.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        setNearby((old) => {
          const next = new Set(old);
          for (const entry of entries) {
            const index = Number((entry.target as HTMLElement).dataset.page);
            if (entry.isIntersecting) next.add(index);
            else next.delete(index);
          }
          return next;
        });
      },
      { root, rootMargin: "800px 0px" },
    );
    observer.current = io;
    for (const element of slots.current.values()) io.observe(element);
    return () => {
      observer.current = null;
      io.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, []);
  const finishJump = useCallback(
    (index: number) => {
      if (pending.current !== index) return;
      slots.current.get(index)?.scrollIntoView({ block: "start" });
      pending.current = null;
      setTarget(null);
      onPosition(index);
    },
    [onPosition],
  );
  useEffect(() => {
    pending.current = jump.page;
    setTarget(jump.page);
    const slot = slots.current.get(jump.page);
    slot?.scrollIntoView({ block: "start" });
    // A neighboring target may already be mounted and decoded; it will not emit
    // another load event. Release the jump lock before the next scroll.
    const frame = requestAnimationFrame(() => {
      const image = slot?.querySelector("img");
      if (image?.complete && image.naturalWidth > 0) finishJump(jump.page);
    });
    return () => cancelAnimationFrame(frame);
  }, [jump, finishJump]);
  const decoded = (index: number, size: Dimensions) => {
    sizes.current.set(index, size);
    onDecoded(index, size);
    if (pending.current === index) {
      requestAnimationFrame(() => {
        finishJump(index);
      });
    } else {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(identify);
    }
  };
  return (
    <div
      ref={canvas}
      className="min-h-0 flex-1 overflow-auto overscroll-contain"
      tabIndex={0}
      aria-label="Vertical manga pages"
      aria-busy={target !== null}
      data-reader-canvas
      onWheel={() => {
        pending.current = null;
        setTarget(null);
      }}
      onPointerDown={() => {
        pending.current = null;
        setTarget(null);
      }}
      onScroll={() => {
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(identify);
      }}
    >
      <div
        className="mx-auto"
        style={{
          width: `${options.zoom}%`,
          maxWidth: `${(900 * options.zoom) / 100}px`,
        }}
      >
        {pages.map((page) => (
          <ContinuousSlot
            key={page.handle}
            page={page}
            active={nearby.has(page.ordinal) || target === page.ordinal}
            size={sizes.current.get(page.ordinal)}
            gap={options.layout === "continuous"}
            onDecoded={(size) => decoded(page.ordinal, size)}
            register={register}
          />
        ))}
      </div>
    </div>
  );
}

function ContinuousSlot({
  page,
  active,
  size,
  gap,
  onDecoded,
  register,
}: {
  page: PositionedPage;
  active: boolean;
  size?: Dimensions;
  gap: boolean;
  onDecoded: (size: Dimensions) => void;
  register: (index: number, element: HTMLDivElement | null) => void;
}) {
  const [dimensions, setDimensions] = useState(size);
  const ref = useCallback(
    (element: HTMLDivElement | null) => register(page.ordinal, element),
    [register, page.ordinal],
  );
  // Keep the measured aspect ratio when the decoded image is released offscreen.
  return (
    <div ref={ref} data-page={page.ordinal} className={gap ? "pb-4" : ""}>
      <div
        style={{
          aspectRatio: dimensions
            ? `${dimensions.width} / ${dimensions.height}`
            : "2 / 3",
          overflowAnchor: "auto",
        }}
      >
        {active ? (
          <PageImage
            page={page}
            options={{
              layout: "webtoon",
              direction: "ltr",
              fit: "width",
              zoom: 100,
              firstPageAlone: false,
            }}
            height={0}
            onDecoded={(value) => {
              setDimensions(value);
              onDecoded(value);
            }}
          />
        ) : (
          <div
            className="h-full w-full"
            aria-label={`Page ${page.ordinal + 1}`}
          />
        )}
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
  page: PositionedPage;
  options: ReaderOptions;
  height: number;
  onDecoded: (size: Dimensions) => void;
}) {
  const images = useContext(ImagesContext)!;
  const image = useQuery({
    queryKey: ["manga-image", page.handle],
    queryFn: () => images.load(page.handle),
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
  });
  const [decodeError, setDecodeError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  if (image.isPending || image.isFetching)
    return (
      <p role="status" className="p-8">
        Loading page {page.ordinal + 1}…
      </p>
    );
  if (image.error || decodeError)
    return (
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
            setAttempt((old) => old + 1);
            void image.refetch();
          }}
        >
          Retry image
        </button>
      </div>
    );
  const maxHeight = height
    ? (Math.max(1, height - 16) * options.zoom) / 100
    : undefined;
  return (
    <img
      key={attempt}
      src={image.data}
      alt={`Page ${page.ordinal + 1}`}
      className={`block object-contain ${options.fit === "original" || options.fit === "height" ? "max-w-none" : "max-w-full"}`}
      style={
        options.fit === "width"
          ? { width: "100%", height: "auto" }
          : options.fit === "original"
            ? { zoom: options.zoom / 100 }
            : {
                maxHeight,
                ...(options.fit === "page"
                  ? { maxWidth: "100%", width: "auto", height: "auto" }
                  : {}),
              }
      }
      onLoad={(event) =>
        onDecoded({
          width: event.currentTarget.naturalWidth,
          height: event.currentTarget.naturalHeight,
        })
      }
      onError={() => setDecodeError(true)}
    />
  );
}
