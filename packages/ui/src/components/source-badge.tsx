import type { MediaItem, MediaKind } from "@vestra/types";
import type * as React from "react";

import { cn } from "../lib/cn";

/**
 * Small uppercase chip identifying what a card is — ANIME, MOVIE, K-DRAMA…
 *
 * Colour is keyed off `kind` rather than `source`, because that is what the
 * user actually perceives: a TMDb film and a Jellyfin film are both "MOVIE".
 */

const KIND_LABEL: Record<MediaKind, string> = {
  anime: "Anime",
  movie: "Movie",
  tv: "TV Show",
  kdrama: "K-Drama",
  "youtube-video": "YouTube",
  "local-video": "Local",
};

const KIND_CLASS: Record<MediaKind, string> = {
  anime: "bg-violet-500/15 text-violet-300",
  movie: "bg-emerald-500/15 text-emerald-300",
  tv: "bg-slate-400/15 text-slate-300",
  kdrama: "bg-sky-500/15 text-sky-300",
  "youtube-video": "bg-red-500/15 text-red-400",
  "local-video": "bg-electric/15 text-electric",
};

export interface SourceBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  kind: MediaKind;
}

export function SourceBadge({ kind, className, ...props }: SourceBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5",
        "text-[9px] font-bold uppercase leading-none tracking-wider",
        KIND_CLASS[kind],
        className,
      )}
      {...props}
    >
      {KIND_LABEL[kind]}
    </span>
  );
}

export function kindLabel(item: Pick<MediaItem, "kind">): string {
  return KIND_LABEL[item.kind];
}
