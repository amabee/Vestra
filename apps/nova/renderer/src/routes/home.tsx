import { mediaKey, type MediaItem } from "@vestra/types";

import {
  EntryList,
  Page,
  PageHeader,
  SectionRule,
} from "@/components/layout/page";
import { useLibrary, useTrending, useWatchlist } from "@/lib/queries";

/**
 * Home.
 *
 * Not a hero banner. A catalogue opens on what you already have and what has
 * just landed — the two questions someone with their own library actually
 * arrives with. Discovery is one click away in the rail; it does not need to
 * be shouted at you on arrival.
 */
export function HomeRoute() {
  const trending = useTrending("anime");
  const { data: watchlist = [] } = useWatchlist();
  const { data: files = [] } = useLibrary();

  const owned = new Set(
    files.flatMap((file) => (file.matchedRef ? [mediaKey(file.matchedRef)] : [])),
  );

  const airing: MediaItem[] = trending.data?.flatMap((group) => group.items) ?? [];
  const continueWatching = watchlist
    .filter((entry) => entry.status === "watching")
    .map((entry) => entry.snapshot);

  return (
    <Page>
      <PageHeader
        eyebrow={new Date().toLocaleDateString(undefined, {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
        title={
          <>
            Your catalogue, <span className="italic text-primary">assembled</span>.
          </>
        }
        lead="Anime, film and series from the sources you trust, alongside the files you already own. Nothing here is a storefront."
      />

      {continueWatching.length > 0 ? (
        <section className="mt-10">
          <SectionRule label="Continue" count={continueWatching.length} />
          <EntryList items={continueWatching} ownedKeys={owned} />
        </section>
      ) : null}

      <section className="mt-10">
        <SectionRule label="Currently airing" count={airing.length} />
        <EntryList
          items={airing.slice(0, 15)}
          pending={trending.isPending}
          error={trending.error as Error | null}
          ownedKeys={owned}
          empty={{
            title: "No sources configured",
            body: "Add provider credentials in Settings and this fills in.",
          }}
        />
      </section>
    </Page>
  );
}
