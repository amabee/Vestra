import { useMutation, useQueryClient } from "@tanstack/react-query";
import { mediaKey } from "@vestra/types";
import { useNavigate, useSearchParams } from "react-router";

import { EntryList, Notice, Page, PageHeader, SectionRule } from "@/components/layout/page";
import { MediaCard, MediaGrid } from "@/components/media/media-card";
import { bridge, type LibraryEntry } from "@/lib/bridge";
import { usePlayer } from "@/lib/player-store";
import {
  keys,
  useHistory,
  useLibrary,
  useLibraryEntries,
  useSearch,
  useWatchlist,
} from "@/lib/queries";

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
  const navigate = useNavigate();
  const openPlayer = usePlayer((state) => state.open);

  const { data: entries = [], isPending, error } = useLibraryEntries();

  const matched = entries.filter((entry) => entry.matched);
  const unmatched = entries.filter((entry) => !entry.matched);

  const play = useMutation({
    mutationFn: async (entry: LibraryEntry) => {
      // A single file is unambiguous; anything more is a series, and choosing
      // an episode on someone's behalf is a guess.
      if (entry.files.length > 1) {
        open(entry);
        return;
      }

      const sources = await bridge.media.resolvePlayback(entry.item);
      const local = sources.find((source) => !source.locator.startsWith("http"));
      if (!local) throw new Error("No local source resolved for this entry.");
      openPlayer(entry.item, [local]);
    },
  });

  const open = (entry: LibraryEntry) => {
    void navigate(
      `/media/${entry.item.source}/${entry.item.kind}/${encodeURIComponent(entry.item.sourceId)}`,
    );
  };

  return (
    <Page>
      <PageHeader
        eyebrow="Yours"
        title="Library"
        lead="Everything on this machine, grouped into the works the files belong to."
      />

      {isPending ? (
        <section className="mt-10">
          <CardSkeletons />
        </section>
      ) : error ? (
        <section className="mt-10">
          <Notice title="Could not read the library" body={(error as Error).message} />
        </section>
      ) : entries.length === 0 ? (
        <section className="mt-10">
          <Notice
            title="Nothing indexed"
            body="Add a media folder in Settings, then run a scan."
          />
        </section>
      ) : (
        <>
          {matched.length > 0 ? (
            <section className="mt-8">
              <MediaGrid>
                {matched.map((entry) => (
                  <MediaCard
                    key={mediaKey(entry.item)}
                    item={entry.item}
                    detail={describe(entry)}
                    onSelect={() => open(entry)}
                    onPlay={() => play.mutate(entry)}
                  />
                ))}
              </MediaGrid>
            </section>
          ) : null}

          {unmatched.length > 0 ? (
            <section className="mt-12">
              <SectionRule
                label="Needs identifying"
                count={unmatched.length}
                trailing={
                  <span className="meta">no catalogue entry found</span>
                }
              />
              <div className="mt-5">
                <MediaGrid>
                  {unmatched.map((entry) => (
                    <MediaCard
                      key={entry.files[0]?.id ?? entry.item.title}
                      item={entry.item}
                      detail={describe(entry)}
                      muted
                      onSelect={() => play.mutate(entry)}
                      onPlay={() => play.mutate(entry)}
                    />
                  ))}
                </MediaGrid>
              </div>
            </section>
          ) : null}
        </>
      )}

      {play.error ? (
        <p className="mt-6 text-xs text-error">{(play.error as Error).message}</p>
      ) : null}
    </Page>
  );
}

function describe(entry: LibraryEntry): string {
  const count = entry.files.length;
  const files = count === 1 ? "1 file" : `${count} files`;
  return `${files} · ${formatBytes(entry.totalBytes)}`;
}

function CardSkeletons() {
  return (
    <MediaGrid>
      {Array.from({ length: 12 }, (_, index) => (
        <div key={index}>
          <div className="aspect-[2/3] animate-pulse rounded-box bg-base-200" />
          <div className="mt-2 h-4 w-3/4 animate-pulse rounded-selector bg-base-200" />
        </div>
      ))}
    </MediaGrid>
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
