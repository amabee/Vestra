import { youtube } from "@vestra/api";
import { isYoutubeConfigured } from "@vestra/config";
import type { MediaItem } from "@vestra/types";
import { EmptyState } from "@vestra/ui";
import { Video } from "lucide-react";
import type { Metadata } from "next";

import { MediaGrid } from "@/components/media/media-grid";

export const metadata: Metadata = { title: "YouTube" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

/**
 * YouTube has no "trending" endpoint on the free quota tier, so this page is
 * search-driven. Results are embeddable-only, so everything here can play inline.
 */
export default async function YoutubePage({ searchParams }: PageProps) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  if (!isYoutubeConfigured()) {
    return (
      <div className="mx-auto max-w-2xl py-16">
        <EmptyState
          icon={<Video className="size-5" />}
          title="YouTube is not connected"
          description="Add YOUTUBE_API_KEY to your .env.local to search and play YouTube videos inside Vestra."
        />
      </div>
    );
  }

  let items: MediaItem[] = [];
  if (query.length >= 2) {
    items = await youtube
      .searchYoutubeDetailed(query, { maxResults: 24 })
      .then((result) => result.items)
      .catch(() => []);
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">YouTube</h1>
        <p className="text-sm text-muted-foreground">
          {query ? `Results for “${query}”` : "Search YouTube with ⌘K, or from the bar above."}
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<Video className="size-5" />}
          title={query ? "No videos found" : "Start searching"}
          description={
            query
              ? "Try a different search term."
              : "Use the global search to find embeddable YouTube videos."
          }
        />
      ) : (
        <MediaGrid items={items} />
      )}
    </div>
  );
}
