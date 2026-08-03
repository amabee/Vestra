"use client";

import type { MediaItem } from "@vestra/types";
import { MediaCard, cn } from "@vestra/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { mediaHref } from "@/lib/routes";

export function itemKey(item: MediaItem): string {
  return `${item.source}:${item.kind}:${item.sourceId}`;
}

export interface MediaRowProps {
  title: string;
  items: readonly MediaItem[];
  /** "See all" destination. Omit to hide the link. */
  href?: string | null;
  variant?: "poster" | "landscape";
  /** Per-item watch progress, keyed by `itemKey`. */
  progressByKey?: Record<string, number>;
  /** Per-item subtitle override, keyed by `itemKey`. */
  subtitleByKey?: Record<string, string>;
  selectedKey?: string | null;
  /** When set, cards select into the details panel instead of navigating. */
  onSelect?: (item: MediaItem) => void;
  index?: number;
  /** Controls rendered between the heading and the arrows (e.g. filter tabs). */
  headerSlot?: React.ReactNode;
}

/** Horizontally scrolling carousel with arrow controls. */
export function MediaRow({
  title,
  items,
  href,
  variant = "poster",
  progressByKey,
  subtitleByKey,
  selectedKey,
  onSelect,
  index = 0,
  headerSlot,
}: MediaRowProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Arrows disable at the ends so they never look broken.
  const updateArrows = useCallback(() => {
    const node = scroller.current;
    if (!node) return;
    setCanScrollLeft(node.scrollLeft > 8);
    setCanScrollRight(node.scrollLeft + node.clientWidth < node.scrollWidth - 8);
  }, []);

  useEffect(() => {
    updateArrows();
    const node = scroller.current;
    if (!node) return;

    const observer = new ResizeObserver(updateArrows);
    observer.observe(node);
    return () => observer.disconnect();
  }, [updateArrows, items]);

  const scrollBy = (direction: -1 | 1) => {
    const node = scroller.current;
    if (!node) return;
    // Page by ~80% of the viewport so a partial card remains as an anchor.
    node.scrollBy({ left: direction * node.clientWidth * 0.8, behavior: "smooth" });
  };

  if (items.length === 0) return null;

  const arrowClass = cn(
    "flex size-7 items-center justify-center rounded-md border border-border bg-secondary/50",
    "text-muted-foreground transition-all duration-200",
    "hover:bg-secondary hover:text-foreground",
    "disabled:pointer-events-none disabled:opacity-30",
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      // Stagger rows so the page assembles instead of popping in at once.
      transition={{
        duration: 0.25,
        delay: Math.min(index * 0.05, 0.3),
        ease: [0.22, 1, 0.36, 1],
      }}
      className="space-y-3"
    >
      <div className="flex items-center gap-4">
        <h2 className="shrink-0 text-[15px] font-semibold tracking-tight">{title}</h2>

        {headerSlot ? (
          <div className="min-w-0 flex-1">{headerSlot}</div>
        ) : (
          <div className="flex-1" />
        )}

        <div className="flex shrink-0 items-center gap-2">
          {href ? (
            <Link
              href={href}
              className="text-[12px] text-muted-foreground transition-colors hover:text-foreground"
            >
              See all
            </Link>
          ) : null}

          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={`Scroll ${title} left`}
              onClick={() => scrollBy(-1)}
              disabled={!canScrollLeft}
              className={arrowClass}
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label={`Scroll ${title} right`}
              onClick={() => scrollBy(1)}
              disabled={!canScrollRight}
              className={arrowClass}
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={scroller}
        onScroll={updateArrows}
        className="row-scroller -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1"
      >
        {items.map((item) => {
          const key = itemKey(item);
          const navigationProps = onSelect
            ? { onSelect }
            : { href: mediaHref(item), linkComponent: Link };

          return (
            <div
              key={key}
              className={cn(
                "shrink-0 snap-start",
                variant === "landscape" ? "w-[248px]" : "w-[132px]",
              )}
            >
              <MediaCard
                item={item}
                variant={variant}
                progress={progressByKey?.[key] ?? null}
                subtitle={subtitleByKey?.[key]}
                selected={selectedKey === key}
                {...navigationProps}
              />
            </div>
          );
        })}
      </div>
    </motion.section>
  );
}
