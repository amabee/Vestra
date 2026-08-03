import type { MediaItem } from "@vestra/types";
import { EmptyState } from "@vestra/ui";
import { TriangleAlert } from "lucide-react";

import { MediaGrid } from "@/components/media/media-grid";

export interface CategoryPageProps {
  title: string;
  description: string;
  /** Loader is expected to throw when its provider is unconfigured. */
  load: () => Promise<MediaItem[]>;
  /** Shown when the provider is unavailable. */
  unavailableHint: string;
}

/** Shared layout for the single-source browse pages (Anime, Movies, TV, …). */
export async function CategoryPage({
  title,
  description,
  load,
  unavailableHint,
}: CategoryPageProps) {
  let items: MediaItem[] = [];
  let error: string | null = null;

  try {
    items = await load();
  } catch (loadError) {
    error = loadError instanceof Error ? loadError.message : "Could not load this section.";
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      {error ? (
        <EmptyState
          icon={<TriangleAlert className="size-5" />}
          title="Source unavailable"
          description={`${error} ${unavailableHint}`}
        />
      ) : items.length === 0 ? (
        <EmptyState title="Nothing here yet" description={unavailableHint} />
      ) : (
        <MediaGrid items={items} />
      )}
    </div>
  );
}
