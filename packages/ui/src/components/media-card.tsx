import { formatRating, toPercent } from "@vestra/core/format";
import type { MediaItem } from "@vestra/types";
import { Play, Star } from "lucide-react";
import type * as React from "react";

import { cn } from "../lib/cn";
import { SourceBadge } from "./source-badge";

export interface MediaCardProps {
  item: MediaItem;
  /**
   * Shape of the artwork. `poster` = 2:3 for browse grids, `landscape` = 16:9
   * for Continue Watching. Defaults to landscape for YouTube, poster otherwise.
   */
  variant?: "poster" | "landscape";
  /** Destination when the card should navigate. Ignored if `onSelect` is set. */
  href?: string;
  /** Watch progress as a 0–1 fraction; renders a bar across the artwork. */
  progress?: number | null;
  /** Replaces the default "year · Series" line, e.g. "Episode 17 · 19m left". */
  subtitle?: string | null;
  /** Coloured kind chip beside the subtitle. */
  showBadge?: boolean;
  showRating?: boolean;
  /** Marks the card as the one currently shown in the details panel. */
  selected?: boolean;
  /** When provided the card becomes a button that selects instead of navigating. */
  onSelect?: (item: MediaItem) => void;
  className?: string;
  /** Navigation component; pass `next/link` so this package stays portable. */
  linkComponent?: React.ElementType;
}

export function MediaCard({
  item,
  variant,
  href,
  progress = null,
  subtitle,
  showBadge = true,
  showRating = true,
  selected = false,
  onSelect,
  className,
  linkComponent,
}: MediaCardProps) {
  const shape = variant ?? (item.kind === "youtube-video" ? "landscape" : "poster");
  const rating = formatRating(item.rating.score);

  // Landscape wants a wide still; poster wants the tall artwork.
  const artwork =
    shape === "landscape"
      ? (item.images.backdrop ?? item.images.thumbnail ?? item.images.poster)
      : (item.images.poster ?? item.images.thumbnail);

  const isButton = typeof onSelect === "function";
  const Wrapper = (
    isButton ? "button" : (linkComponent ?? (href ? "a" : "div"))
  ) as React.ElementType;

  const wrapperProps = isButton
    ? { type: "button" as const, onClick: () => onSelect(item), "aria-pressed": selected }
    : href
      ? { href }
      : {};

  const defaultSubtitle =
    [item.year, item.isSeries ? "Series" : null].filter(Boolean).join(" · ") || "—";

  // Continue Watching cards show their play affordance at rest, like the design.
  const alwaysShowPlay = shape === "landscape" && progress !== null;

  return (
    <Wrapper
      {...wrapperProps}
      className={cn("group/card block w-full text-left focus:outline-none", className)}
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-xl bg-surface-raised",
          "shadow-soft transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
          "group-hover/card:-translate-y-1 group-hover/card:shadow-lifted",
          "group-focus-visible/card:ring-2 group-focus-visible/card:ring-ring",
          selected && "ring-2 ring-primary",
          shape === "landscape" ? "aspect-video" : "aspect-[2/3]",
        )}
        // AniList ships a dominant colour; use it so the card never flashes grey.
        style={
          item.images.placeholder?.startsWith("#")
            ? { backgroundColor: item.images.placeholder }
            : undefined
        }
      >
        {artwork ? (
          <img
            src={artwork}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/card:scale-105"
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-secondary/50 p-3 text-center text-xs text-muted-foreground">
            {item.title}
          </div>
        )}

        <div
          className={cn(
            "pointer-events-none absolute inset-0 bg-black/30 transition-opacity duration-200",
            alwaysShowPlay ? "opacity-100" : "opacity-0 group-hover/card:opacity-100",
          )}
        />

        <div
          className={cn(
            "pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-200",
            alwaysShowPlay ? "opacity-100" : "opacity-0 group-hover/card:opacity-100",
          )}
        >
          <span
            className={cn(
              "flex items-center justify-center rounded-full border border-white/25 bg-black/40 backdrop-blur-sm",
              "transition-transform duration-200 group-hover/card:scale-110",
              shape === "landscape" ? "size-11" : "size-12",
            )}
          >
            <Play className="size-4 translate-x-px fill-white text-white" />
          </span>
        </div>

        {showRating && rating ? (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold backdrop-blur-sm">
            <Star className="size-2.5 fill-amber-400 text-amber-400" />
            {rating}
          </span>
        ) : null}

        {progress !== null && progress > 0 ? (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
            <div
              className="h-full bg-gradient-to-r from-violet to-electric transition-[width] duration-300"
              style={{ width: `${toPercent(progress)}%` }}
            />
          </div>
        ) : null}
      </div>

      <div className="mt-2 space-y-1">
        <p
          className="line-clamp-1 text-[13px] font-medium leading-snug transition-colors group-hover/card:text-violet-soft"
          title={item.title}
        >
          {item.title}
        </p>

        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[11px] text-muted-foreground">
            {subtitle ?? defaultSubtitle}
          </p>
          {showBadge ? <SourceBadge kind={item.kind} /> : null}
        </div>
      </div>
    </Wrapper>
  );
}
