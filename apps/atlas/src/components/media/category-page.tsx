import type { MediaKind } from "@vestra/types";
import { EmptyState } from "@vestra/ui";
import { getTrendingByKind } from "@vestra/core/discover";
import { TriangleAlert } from "lucide-react";

import { MediaGrid } from "@/components/media/media-grid";
import { getProviderRegistry } from "@/lib/registry";

export interface CategoryPageProps {
  title: string;
  description: string;
  /** Content kind to pull trending for, across every provider that serves it. */
  kind: MediaKind;
  /** Shown when no provider can serve this kind. */
  unavailableHint: string;
}

/** Shared layout for the single-kind browse pages (Anime, Movies, TV, K-Drama). */
export async function CategoryPage({
  title,
  description,
  kind,
  unavailableHint,
}: CategoryPageProps) {
  const providers = getProviderRegistry();
  const { items, errors } = await getTrendingByKind(providers, kind, 30);

  // No registered provider serves this kind, or none are configured.
  const noProvider = providers.supporting(kind).length === 0;

  return (
    <div className="space-y-6 pb-8">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-[13px] text-muted-foreground">{description}</p>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<TriangleAlert className="size-5" />}
          title={noProvider ? "No source configured" : "Nothing to show"}
          description={errors[0] ? `${errors[0]} ${unavailableHint}` : unavailableHint}
        />
      ) : (
        <MediaGrid items={items} />
      )}
    </div>
  );
}
