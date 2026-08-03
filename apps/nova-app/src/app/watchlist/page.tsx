import { getWatchlist } from "@vestra/storage";
import { EmptyState } from "@vestra/ui";
import { Bookmark } from "lucide-react";
import type { Metadata } from "next";

import { MediaGrid } from "@/components/media/media-grid";
import { getDriver } from "@/lib/storage";

export const metadata: Metadata = { title: "Watchlist" };
export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const entries = await getWatchlist(getDriver());

  return (
    <div className="space-y-6 pb-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Watchlist</h1>
        <p className="text-sm text-muted-foreground">
          {entries.length} title{entries.length === 1 ? "" : "s"} saved
        </p>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon={<Bookmark className="size-5" />}
          title="Your watchlist is empty"
          description="Add anything you want to watch later and it will show up here."
        />
      ) : (
        // Snapshots are stored with each entry, so this renders without refetching.
        <MediaGrid items={entries.map((entry) => entry.snapshot)} />
      )}
    </div>
  );
}
