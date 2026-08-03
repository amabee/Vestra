"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { SEARCH_DEBOUNCE_MS } from "@vestra/config/constants";
import { formatRating } from "@vestra/core/format";
import type { MediaItem, SearchResponse } from "@vestra/types";
import { cn } from "@vestra/ui/cn";
import { Clock, LoaderCircle, Search, Star, TriangleAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { mediaHref } from "@/lib/routes";
import { useSearchStore } from "@/stores/search-store";
import { useUiStore } from "@/stores/ui-store";

async function fetchSearch(query: string, signal: AbortSignal): Promise<SearchResponse> {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal });
  if (!response.ok) throw new Error(`Search failed (${response.status})`);
  return (await response.json()) as SearchResponse;
}

function ResultRow({
  item,
  active,
  onSelect,
  onHover,
}: {
  item: MediaItem;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  const rating = formatRating(item.rating.score);
  const thumb = item.images.thumbnail ?? item.images.poster;

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseMove={onHover}
      // `data-active` drives styling so keyboard and pointer highlight identically.
      data-active={active || undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-150",
        "data-[active]:bg-secondary/80",
      )}
    >
      <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-md bg-secondary">
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" className="size-full object-cover" />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[item.year, item.isSeries ? "Series" : null].filter(Boolean).join(" · ") || "—"}
        </p>
      </div>

      {rating ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <Star className="size-3 fill-amber-400 text-amber-400" />
          {rating}
        </span>
      ) : null}
    </button>
  );
}

export function SearchDialog() {
  const open = useUiStore((state) => state.searchOpen);
  const setOpen = useUiStore((state) => state.setSearchOpen);
  const recent = useSearchStore((state) => state.recent);
  const addRecent = useSearchStore((state) => state.addRecent);
  const clearRecent = useSearchStore((state) => state.clearRecent);

  const router = useRouter();
  const [input, setInput] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const debounced = useDebouncedValue(input.trim(), SEARCH_DEBOUNCE_MS);
  const enabled = debounced.length >= 2;

  const { data, isFetching, isError } = useQuery({
    queryKey: ["search", debounced],
    queryFn: ({ signal }) => fetchSearch(debounced, signal),
    enabled: open && enabled,
    staleTime: 30_000,
  });

  // Flattened list backs keyboard navigation across all source groups.
  const flat = useMemo(
    () => data?.groups.flatMap((group) => group.items) ?? [],
    [data],
  );

  // Reset the highlight when the query changes. Adjusting state during render
  // (rather than in an effect) avoids a cascading second render pass.
  const [indexedQuery, setIndexedQuery] = useState(debounced);
  if (indexedQuery !== debounced) {
    setIndexedQuery(debounced);
    setActiveIndex(0);
  }

  // Global Cmd/Ctrl+K to open, Esc handled by Radix.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen(true);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);

  const goTo = useCallback(
    (item: MediaItem) => {
      addRecent(debounced);
      setOpen(false);
      setInput("");
      router.push(mediaHref(item));
    },
    [addRecent, debounced, router, setOpen],
  );

  const onInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (flat.length === 0) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % flat.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + flat.length) % flat.length);
      } else if (event.key === "Enter") {
        event.preventDefault();
        const item = flat[activeIndex];
        if (item) goTo(item);
      }
    },
    [activeIndex, flat, goTo],
  );

  // Keep the highlighted row in view while arrowing through results.
  useEffect(() => {
    const node = listRef.current?.querySelector("[data-active]");
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  let flatCursor = 0;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />

        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-[12vh] z-50 w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2",
            "glass-strong overflow-hidden rounded-3xl shadow-lifted",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
            "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
          )}
        >
          <Dialog.Title className="sr-only">Search Vestra</Dialog.Title>

          <div className="flex items-center gap-3 border-b border-glass-border px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search anime, movies, shows, YouTube…"
              className="h-14 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {isFetching ? (
              <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
            ) : null}
            <Dialog.Close className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div ref={listRef} className="max-h-[55vh] overflow-y-auto p-2">
            {!enabled ? (
              recent.length > 0 ? (
                <div className="p-1">
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      Recent
                    </p>
                    <button
                      type="button"
                      onClick={clearRecent}
                      className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Clear
                    </button>
                  </div>
                  {recent.map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      onClick={() => setInput(entry)}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-secondary/70"
                    >
                      <Clock className="size-3.5 text-muted-foreground" />
                      <span className="truncate">{entry}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="px-3 py-10 text-center text-sm text-muted-foreground">
                  Type at least 2 characters to search every connected source.
                </p>
              )
            ) : isError ? (
              <p className="px-3 py-10 text-center text-sm text-destructive">
                Search failed. Check your connection and try again.
              </p>
            ) : flat.length === 0 && !isFetching ? (
              <p className="px-3 py-10 text-center text-sm text-muted-foreground">
                No results for “{debounced}”.
              </p>
            ) : (
              data?.groups.map((group) => (
                <div key={group.source} className="mb-2">
                  <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {group.label}
                    {group.totalResults > 0 ? (
                      <span className="ml-1.5 font-normal normal-case tracking-normal">
                        {group.totalResults}
                      </span>
                    ) : null}
                  </p>

                  {group.error ? (
                    <p className="flex items-center gap-2 px-3 py-2 text-xs text-amber-400">
                      <TriangleAlert className="size-3.5 shrink-0" />
                      {group.error}
                    </p>
                  ) : (
                    group.items.map((item) => {
                      const index = flatCursor++;
                      return (
                        <ResultRow
                          key={`${item.source}-${item.kind}-${item.sourceId}`}
                          item={item}
                          active={index === activeIndex}
                          onSelect={() => goTo(item)}
                          onHover={() => setActiveIndex(index)}
                        />
                      );
                    })
                  )}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center gap-4 border-t border-glass-border px-4 py-2 text-[11px] text-muted-foreground">
            <span>
              <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono">↵</kbd> open
            </span>
            <span>
              <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono">esc</kbd> close
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
