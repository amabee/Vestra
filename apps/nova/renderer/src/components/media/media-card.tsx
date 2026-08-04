import type { MediaItem } from "@vestra/types";
import { Film, Play } from "lucide-react";
import { useState } from "react";

/**
 * Poster card.
 *
 * The catalogue row is right for browsing a source, where titles are being
 * compared and metadata matters. The library is a different act — you already
 * know what you own, you are looking for a specific thing, and recognition by
 * artwork is faster than reading. So this is the one place the poster leads.
 *
 * It still carries the house style: serif title, mono metadata underneath,
 * squared corners, no drop shadow.
 */

export interface MediaCardProps {
  item: MediaItem;
  /** Secondary line, e.g. "12 files · 8.4 GB". */
  detail?: string;
  /** Dimmed treatment for entries with no resolved metadata. */
  muted?: boolean;
  onSelect?: () => void;
  onPlay?: () => void;
}

export function MediaCard({ item, detail, muted, onSelect, onPlay }: MediaCardProps) {
  const [failed, setFailed] = useState(false);
  const poster = item.images.poster ?? item.images.thumbnail;
  const showImage = Boolean(poster) && !failed;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect?.();
        }
      }}
      className="group cursor-pointer text-left focus:outline-none"
    >
      <div
        className={[
          "relative aspect-[2/3] overflow-hidden rounded-box border rule bg-base-200",
          "transition-colors group-hover:border-primary/40 group-focus:border-primary/40",
        ].join(" ")}
      >
        {showImage ? (
          <img
            src={poster ?? ""}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className={[
              "size-full object-cover transition-transform duration-300 group-hover:scale-[1.04]",
              muted ? "opacity-45 grayscale" : "",
            ].join(" ")}
          />
        ) : (
          // No artwork is the normal case for an unmatched file, so it gets a
          // deliberate placeholder rather than an empty box.
          <div className="grid size-full place-items-center">
            <Film className="size-7 text-base-content/20" />
          </div>
        )}

        {onPlay ? (
          <button
            type="button"
            aria-label={`Play ${item.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onPlay();
            }}
            className="absolute inset-0 grid place-items-center bg-base-100/55 opacity-0 backdrop-blur-[1px] transition-opacity group-hover:opacity-100 focus:opacity-100 focus:outline-none"
          >
            <span className="grid size-11 place-items-center rounded-full bg-primary text-primary-content">
              <Play className="size-4 translate-x-px fill-current" />
            </span>
          </button>
        ) : null}
      </div>

      <h3 className="mt-2 line-clamp-2 font-serif text-[17px] leading-tight transition-colors group-hover:text-primary">
        {item.title}
      </h3>

      {detail ? <p className="meta mt-0.5">{detail}</p> : null}
    </div>
  );
}

/** Responsive poster grid. Column count is driven by width, not a breakpoint list. */
export function MediaGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-4 gap-y-6">
      {children}
    </div>
  );
}
