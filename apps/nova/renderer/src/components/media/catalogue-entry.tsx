import type { MediaItem } from "@vestra/types";

import { EntryActions } from "./entry-actions";

/**
 * A catalogue entry.
 *
 * This is where the design argument lives, so it is worth being explicit.
 *
 * Every other app in this space renders a poster with the title underneath in
 * small grey text. That makes artwork the subject and the work itself an
 * afterthought — fine for a storefront selling browsing time, wrong for a
 * library someone has assembled deliberately.
 *
 * Here the title is set large in the serif, the artwork is a supporting
 * portrait beside it, and the technical facts are set in mono like a card
 * index. Scanning a column of these reads as a catalogue, not a shelf.
 */

export interface CatalogueEntryProps {
  item: MediaItem;
  /** Position in the list, printed as a card-index mark. */
  index?: number;
  owned?: boolean;
  onSelect?: (item: MediaItem) => void;
}

export function CatalogueEntry({ item, index, owned, onSelect }: CatalogueEntryProps) {
  const poster = item.images.poster ?? item.images.thumbnail;

  return (
    // A div, not a button: the row now contains its own buttons, and nesting
    // interactive elements is invalid HTML that breaks keyboard navigation in
    // ways that are hard to see and easy to ship.
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(item)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect?.(item);
        }
      }}
      className="group grid w-full cursor-pointer grid-cols-[2.5rem_3.5rem_1fr_auto] items-center gap-4 border-b rule px-2 py-3 text-left transition-colors hover:bg-base-200/50 focus:bg-base-200/50 focus:outline-none"
    >
      <span className="index-mark self-start pt-1 text-right tabular-nums">
        {index === undefined ? "" : String(index + 1).padStart(2, "0")}
      </span>

      <div className="aspect-[2/3] w-14 self-start overflow-hidden rounded-selector bg-base-200">
        {poster ? (
          <img
            src={poster}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : null}
      </div>

      <div className="min-w-0 space-y-1">
        <h3 className="truncate font-serif text-display-sm transition-colors group-hover:text-primary">
          {item.title}
        </h3>

        <MetaLine item={item} owned={owned} />

        {item.overview ? (
          <p className="line-clamp-1 max-w-[80ch] text-[13px] leading-relaxed text-base-content/50">
            {item.overview}
          </p>
        ) : null}
      </div>

      <EntryActions item={item} />
    </div>
  );
}

/**
 * The technical line.
 *
 * Deliberately dense and unadorned — it is data, and the mono treatment lets
 * the eye skip it until it is wanted.
 */
function MetaLine({ item, owned }: { item: MediaItem; owned?: boolean }) {
  const parts: string[] = [];

  if (item.year) parts.push(String(item.year));
  parts.push(item.isSeries ? "Series" : "Film");
  if (item.rating.score !== null) parts.push(`${Math.round(item.rating.score)}%`);
  parts.push(item.source);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="meta">{parts.join(" · ")}</span>

      {owned ? (
        // The one thing this app is actually about: you have the file.
        <span className="meta rounded-selector bg-accent/15 px-1.5 text-accent">
          Owned
        </span>
      ) : null}
    </div>
  );
}
