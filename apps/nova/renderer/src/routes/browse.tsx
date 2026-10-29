import { mediaKey, type MediaKind } from "@vestra/types";

import {
  EntryList,
  Page,
  PageHeader,
  SectionRule,
} from "@/components/layout/page";
import { useLibrary, useTrending } from "@/lib/queries";
import { AnimeSources } from "@/components/media/anime-sources";

/**
 * Browse a single kind.
 *
 * Anime, Films and Series are the same screen with a different `kind`, so they
 * share one implementation. Results stay grouped by provider rather than being
 * merged into one ranked list: which source a title came from is information,
 * and flattening it away would hide that TMDb is down while AniList is fine.
 */
export function BrowseRoute({
  kind,
  title,
  lead,
}: {
  kind: MediaKind;
  title: string;
  lead: string;
}) {
  const trending = useTrending(kind);
  const { data: files = [] } = useLibrary();

  const owned = new Set(
    files.flatMap((file) =>
      file.matchedRef ? [mediaKey(file.matchedRef)] : [],
    ),
  );

  const groups = trending.data ?? [];

  return (
    <Page>
      <PageHeader eyebrow="Browse" title={title} lead={lead} />
      {kind === "anime" && <AnimeSources />}

      {trending.isPending || groups.length === 0 ? (
        <section className="mt-10">
          <SectionRule label="Trending" />
          <EntryList
            items={[]}
            pending={trending.isPending}
            error={trending.error as Error | null}
            empty={{
              title: "No source serves this yet",
              body: "Configure a provider that supports this kind in Settings.",
            }}
          />
        </section>
      ) : (
        groups.map((group) => (
          <section key={group.providerId} className="mt-10">
            <SectionRule
              label={group.providerName}
              count={group.items.length}
              trailing={
                group.error ? (
                  <span className="meta text-error">unavailable</span>
                ) : null
              }
            />
            <EntryList
              items={group.items}
              ownedKeys={owned}
              empty={{
                title: group.error ?? "Nothing returned",
                body: group.error ? undefined : "This source had no results.",
              }}
            />
          </section>
        ))
      )}
    </Page>
  );
}
