import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDuration } from "@vestra/core/format";
import { mediaKey } from "@vestra/types";
import { useSearchParams } from "react-router";

import { EntryList, Notice, Page, PageHeader, SectionRule } from "@/components/layout/page";
import { bridge } from "@/lib/bridge";
import { keys, useHistory, useLibrary, useSearch, useWatchlist } from "@/lib/queries";

/* =============================================================================
 * Watchlist
 * ========================================================================== */

export function WatchlistRoute() {
  const { data: entries = [], isPending, error } = useWatchlist();
  const { data: files = [] } = useLibrary();

  const owned = new Set(
    files.flatMap((file) => (file.matchedRef ? [mediaKey(file.matchedRef)] : [])),
  );

  // Grouped by intent rather than one long list — "watching" and "planned" are
  // different questions, and a catalogue should answer them separately.
  const groups = [
    { status: "watching", label: "Watching" },
    { status: "planned", label: "Planned" },
    { status: "completed", label: "Completed" },
    { status: "dropped", label: "Dropped" },
  ] as const;

  return (
    <Page>
      <PageHeader
        eyebrow="Yours"
        title="Watchlist"
        lead="Titles you have set aside. Nothing here is recommended to you by anyone."
      />

      {isPending || error || entries.length === 0 ? (
        <section className="mt-10">
          <EntryList
            items={[]}
            pending={isPending}
            error={error as Error | null}
            empty={{
              title: "Nothing set aside",
              body: "Use the bookmark on any entry to add it here.",
            }}
          />
        </section>
      ) : (
        groups.map((group) => {
          const items = entries
            .filter((entry) => entry.status === group.status)
            .map((entry) => entry.snapshot);

          if (items.length === 0) return null;

          return (
            <section key={group.status} className="mt-10">
              <SectionRule label={group.label} count={items.length} />
              <EntryList items={items} ownedKeys={owned} />
            </section>
          );
        })
      )}
    </Page>
  );
}

/* =============================================================================
 * History
 * ========================================================================== */

export function HistoryRoute() {
  const { data: entries = [], isPending, error } = useHistory();
  const queryClient = useQueryClient();

  const clear = useMutation({
    mutationFn: () => bridge.history.clear(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.history }),
  });

  return (
    <Page>
      <PageHeader
        eyebrow="Yours"
        title="History"
        lead="What you have watched, kept locally and never sent anywhere."
        actions={
          entries.length > 0 ? (
            <button
              type="button"
              onClick={() => clear.mutate()}
              className="rounded-field border rule px-3 py-1.5 text-xs text-base-content/60 transition-colors hover:border-error/50 hover:text-error"
            >
              Clear history
            </button>
          ) : null
        }
      />

      <section className="mt-10">
        <EntryList
          items={entries.map((entry) => entry.snapshot)}
          pending={isPending}
          error={error as Error | null}
          empty={{
            title: "Nothing watched yet",
            body: "Playback is recorded here as you go.",
          }}
        />
      </section>
    </Page>
  );
}

/* =============================================================================
 * Local library
 * ========================================================================== */

export function LibraryRoute() {
  const { data: files = [], isPending, error } = useLibrary();

  const matched = files.filter((file) => file.matchedRef !== null);
  const unmatched = files.filter((file) => file.matchedRef === null);

  return (
    <Page>
      <PageHeader
        eyebrow="Yours"
        title="Library"
        lead="Files on this machine, matched against catalogue metadata where possible."
      />

      {isPending ? (
        <section className="mt-10">
          <EntryList items={[]} pending />
        </section>
      ) : error ? (
        <section className="mt-10">
          <Notice title="Could not read the library" body={(error as Error).message} />
        </section>
      ) : files.length === 0 ? (
        <section className="mt-10">
          <Notice
            title="No folders indexed"
            body="Add a media folder in Settings, then run a scan."
          />
        </section>
      ) : (
        <>
          <section className="mt-10">
            <SectionRule label="Matched" count={matched.length} />
            <FileTable files={matched} />
          </section>

          {unmatched.length > 0 ? (
            <section className="mt-10">
              <SectionRule label="Unmatched" count={unmatched.length} />
              <FileTable files={unmatched} />
            </section>
          ) : null}
        </>
      )}
    </Page>
  );
}

/**
 * Files as a table, not entries.
 *
 * A file is a different object from a work: what matters is path, size,
 * duration and whether it matched. Rendering it with the same poster-led row as
 * a catalogue entry would flatter it into something it is not.
 */
function FileTable({
  files,
}: {
  files: { id: string; path: string; sizeBytes: number; durationSeconds: number | null }[];
}) {
  return (
    <div>
      {files.map((file, index) => (
        <div
          key={file.id}
          className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-4 border-b rule px-2 py-2.5"
        >
          <span className="index-mark text-right tabular-nums">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span
            data-selectable
            className="truncate font-mono text-[12px] text-base-content/75"
            title={file.path}
          >
            {file.path}
          </span>
          <span className="meta whitespace-nowrap">
            {formatBytes(file.sizeBytes)}
            {file.durationSeconds ? ` · ${formatDuration(file.durationSeconds)}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/* =============================================================================
 * Search
 * ========================================================================== */

export function SearchRoute() {
  const [params] = useSearchParams();
  const query = params.get("q") ?? "";

  const { data, isPending, error } = useSearch(query);
  const { data: files = [] } = useLibrary();

  const owned = new Set(
    files.flatMap((file) => (file.matchedRef ? [mediaKey(file.matchedRef)] : [])),
  );

  const groups = data?.groups ?? [];
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <Page>
      <PageHeader
        eyebrow={total > 0 ? `${total} results` : "Search"}
        title={query ? `“${query}”` : "Search"}
        lead={query ? undefined : "Type in the bar above to search every configured source at once."}
      />

      {!query ? null : isPending ? (
        <section className="mt-10">
          <EntryList items={[]} pending />
        </section>
      ) : error ? (
        <section className="mt-10">
          <Notice title="Search failed" body={(error as Error).message} />
        </section>
      ) : total === 0 ? (
        <section className="mt-10">
          <Notice title="Nothing found" body="No configured source returned a match." />
        </section>
      ) : (
        groups.map((group) => (
          <section key={group.source} className="mt-10">
            <SectionRule
              label={group.source}
              count={group.items.length}
              trailing={
                group.error ? <span className="meta text-error">unavailable</span> : null
              }
            />
            <EntryList items={group.items} ownedKeys={owned} />
          </section>
        ))
      )}
    </Page>
  );
}
