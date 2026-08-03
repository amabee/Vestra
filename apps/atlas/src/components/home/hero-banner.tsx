"use client";

import { formatDuration, formatRating, truncate } from "@vestra/core/format";
import type { MediaItem } from "@vestra/types";
import { SourceBadge, cn } from "@vestra/ui";
import { Info, Play, Star } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

import { useUiStore } from "@/stores/ui-store";

/**
 * Cinematic spotlight at the top of Home.
 *
 * Rotates through a handful of featured titles. Rotation pauses on hover so it
 * never yanks the content out from under a reader.
 */

const ROTATE_MS = 9000;

export function HeroBanner({ items }: { items: MediaItem[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const openPlayer = useUiStore((state) => state.openPlayer);
  const setSelectedMedia = useUiStore((state) => state.setSelectedMedia);

  const featured = items.slice(0, 5);

  useEffect(() => {
    if (paused || featured.length <= 1) return;

    const timer = setInterval(
      () => setIndex((current) => (current + 1) % featured.length),
      ROTATE_MS,
    );
    return () => clearInterval(timer);
  }, [paused, featured.length]);

  if (featured.length === 0) return null;

  const item = featured[index] ?? featured[0];
  if (!item) return null;

  const backdrop = item.images.backdrop ?? item.images.poster;
  const rating = formatRating(item.rating.score);
  const runtime = formatDuration(item.durationSeconds);

  return (
    <section
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      // Bleed past the main padding so the artwork runs edge to edge.
      className="relative -mx-6 -mt-5 h-[340px] overflow-hidden"
    >
      <AnimatePresence mode="popLayout">
        <motion.div
          key={`${item.source}-${item.sourceId}`}
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-0"
        >
          {backdrop ? (
            <img src={backdrop} alt="" className="size-full object-cover" />
          ) : (
            <div className="size-full bg-surface-raised" />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Scrims: bottom fade into the page, left fade behind the copy. */}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/40 to-transparent" />

      <div className="relative flex h-full flex-col justify-end gap-3 px-6 pb-6">
        <motion.div
          key={`copy-${item.source}-${item.sourceId}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-xl space-y-3"
        >
          <div className="flex items-center gap-2">
            <SourceBadge kind={item.kind} />
            {rating ? (
              <span className="flex items-center gap-1 text-[11px] font-semibold">
                <Star className="size-3 fill-amber-400 text-amber-400" />
                {rating}
              </span>
            ) : null}
            {item.year ? (
              <span className="text-[11px] text-muted-foreground">{item.year}</span>
            ) : null}
            {runtime ? (
              <span className="text-[11px] text-muted-foreground">{runtime}</span>
            ) : null}
          </div>

          <h1 className="text-3xl font-bold leading-tight tracking-tight drop-shadow-lg">
            {item.title}
          </h1>

          {item.overview ? (
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {truncate(item.overview, 190)}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => openPlayer(item)}
              className="flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-[13px] font-semibold text-primary-foreground shadow-soft transition-all duration-200 hover:bg-primary/90 hover:shadow-glow-violet active:scale-[0.98]"
            >
              <Play className="size-4 fill-current" />
              Play
            </button>

            <button
              type="button"
              onClick={() => setSelectedMedia(item)}
              className="glass flex h-10 items-center gap-2 rounded-lg px-4 text-[13px] font-medium transition-all duration-200 hover:bg-secondary/70 active:scale-[0.98]"
            >
              <Info className="size-4" />
              More info
            </button>
          </div>
        </motion.div>

        {featured.length > 1 ? (
          <div className="flex gap-1.5 pt-1">
            {featured.map((entry, entryIndex) => (
              <button
                key={`${entry.source}-${entry.sourceId}`}
                type="button"
                aria-label={`Show ${entry.title}`}
                onClick={() => setIndex(entryIndex)}
                className={cn(
                  "h-1 rounded-full transition-all duration-300",
                  entryIndex === index
                    ? "w-6 bg-violet-soft"
                    : "w-2 bg-white/25 hover:bg-white/40",
                )}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
