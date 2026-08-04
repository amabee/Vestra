import { mediaKey, type MediaItem } from "@vestra/types";
import { useNavigate } from "react-router";

import { CatalogueEntry } from "@/components/media/catalogue-entry";

/**
 * Page furniture.
 *
 * Every screen is the same shape — a masthead, a ruled section header, and a
 * list. Keeping that in one place is what makes the catalogue feel like one
 * document rather than nine screens that happen to share a palette.
 */

export function PageHeader({
  eyebrow,
  title,
  lead,
  actions,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lead?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex items-end justify-between gap-6 border-b rule pb-6">
      <div className="min-w-0">
        {eyebrow ? <p className="meta">{eyebrow}</p> : null}
        <h1 className="mt-2 font-serif text-display text-balance">{title}</h1>
        {lead ? (
          <p className="mt-3 max-w-[58ch] text-sm leading-relaxed text-base-content/55">
            {lead}
          </p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  );
}

export function SectionRule({
  label,
  count,
  trailing,
}: {
  label: string;
  count?: number;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="mb-1 flex items-baseline justify-between gap-4 border-b rule pb-2">
      <h2 className="font-serif text-display-sm">{label}</h2>
      <div className="flex items-baseline gap-3">
        {count !== undefined && count > 0 ? (
          <span className="meta">{count} entries</span>
        ) : null}
        {trailing}
      </div>
    </div>
  );
}

export function Notice({ title, body }: { title: string; body?: string }) {
  return (
    <div className="border-b rule py-12">
      <p className="font-serif text-display-sm text-base-content/70">{title}</p>
      {body ? (
        <p className="mt-1 max-w-[58ch] text-sm text-base-content/45">{body}</p>
      ) : null}
    </div>
  );
}

export function EntrySkeletons({ rows = 5 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="grid grid-cols-[2.5rem_3.5rem_1fr] items-start gap-4 border-b rule px-2 py-3"
        >
          <div />
          <div className="aspect-[2/3] w-14 animate-pulse rounded-selector bg-base-200" />
          <div className="space-y-2 pt-1">
            <div className="h-6 w-1/2 animate-pulse rounded-selector bg-base-200" />
            <div className="h-3 w-32 animate-pulse rounded-selector bg-base-200" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A list of entries, or the honest reason there are none. */
export function EntryList({
  items,
  pending,
  error,
  empty,
  ownedKeys,
  onSelect,
}: {
  items: MediaItem[];
  pending?: boolean;
  error?: Error | null;
  empty?: { title: string; body?: string };
  ownedKeys?: Set<string>;
  onSelect?: (item: MediaItem) => void;
}) {
  const navigate = useNavigate();

  // Selecting an entry goes to its detail page unless a caller wants otherwise.
  const select =
    onSelect ??
    ((item: MediaItem) =>
      void navigate(`/media/${item.source}/${item.kind}/${encodeURIComponent(item.sourceId)}`));

  if (pending) return <EntrySkeletons />;

  if (error) {
    return <Notice title="Could not load this" body={error.message} />;
  }

  if (items.length === 0) {
    return (
      <Notice
        title={empty?.title ?? "Nothing here yet"}
        body={empty?.body}
      />
    );
  }

  return (
    <div>
      {items.map((item, index) => (
        <CatalogueEntry
          key={mediaKey(item)}
          item={item}
          index={index}
          owned={ownedKeys?.has(mediaKey(item))}
          onSelect={select}
        />
      ))}
    </div>
  );
}

/** Full-bleed page frame. Rows run the width of the window, not a column. */
export function Page({ children }: { children: React.ReactNode }) {
  return <div className="px-8 py-10">{children}</div>;
}
