import { universalSearch } from "@vestra/core/search";
import { searchQuerySchema } from "@vestra/types";
import { EmptyState } from "@vestra/ui";
import { Search, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";

import { MediaGrid } from "@/components/media/media-grid";
import { getProviderRegistry } from "@/lib/registry";

export const metadata: Metadata = { title: "Search" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function SearchPage({ searchParams }: PageProps) {
  const { q } = await searchParams;
  const parsed = searchQuerySchema.safeParse({ query: q ?? "" });

  if (!parsed.success) {
    return (
      <div className="mx-auto max-w-2xl py-16">
        <EmptyState
          icon={<Search className="size-5" />}
          title="Search Vestra"
          description="Press ⌘K or start typing to search anime, movies, TV, K-drama and YouTube at once."
        />
      </div>
    );
  }

  const results = await universalSearch(parsed.data, {
    providers: getProviderRegistry(),
  });

  return (
    <div className="space-y-8 pb-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Results for “{parsed.data.query}”
        </h1>
        <p className="text-sm text-muted-foreground">
          {results.totalResults} result{results.totalResults === 1 ? "" : "s"} across{" "}
          {results.groups.length} source{results.groups.length === 1 ? "" : "s"}
        </p>
      </div>

      {results.groups.length === 0 ? (
        <EmptyState
          icon={<Search className="size-5" />}
          title="No results"
          description={`Nothing matched “${parsed.data.query}”. Try a different spelling.`}
        />
      ) : (
        results.groups.map((group) => (
          <section key={group.source} className="space-y-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-lg font-semibold tracking-tight">{group.label}</h2>
              <span className="text-xs text-muted-foreground">{group.totalResults}</span>
            </div>

            {group.error ? (
              <p className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                <TriangleAlert className="size-4 shrink-0" />
                {group.error}
              </p>
            ) : (
              <MediaGrid items={group.items} />
            )}
          </section>
        ))
      )}
    </div>
  );
}
