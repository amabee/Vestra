import { getContinueWatching } from "@vestra/core/continue-watching";
import { getTrendingByKind } from "@vestra/core/discover";
import { recentlyAddedLocal } from "@vestra/providers/local-library";
import { getLocalFiles } from "@vestra/storage";
import type { MediaItem } from "@vestra/types";
import { Button, EmptyState } from "@vestra/ui";
import { Compass, Settings } from "lucide-react";
import Link from "next/link";

import { HomeView, type ContinueWatchingCard } from "@/components/home/home-view";
import { getProviderRegistry } from "@/lib/registry";
import { getDriver } from "@/lib/storage";

/** Home. Rendered on the server so provider keys never reach the client. */

// Rows include local library state, which changes outside the request cycle.
export const dynamic = "force-dynamic";

/** Interleave provider results so the "All" tab isn't one source at a time. */
function interleave(groups: MediaItem[][]): MediaItem[] {
  const longest = Math.max(0, ...groups.map((group) => group.length));
  const merged: MediaItem[] = [];

  for (let index = 0; index < longest; index += 1) {
    for (const group of groups) {
      const item = group[index];
      if (item) merged.push(item);
    }
  }

  return merged;
}

export default async function HomePage() {
  const driver = getDriver();
  const providers = getProviderRegistry();

  const [progressEntries, anime, movies, kdrama, tv, localFiles] = await Promise.all([
    getContinueWatching(driver, 12).catch(() => []),
    getTrendingByKind(providers, "anime", 20),
    getTrendingByKind(providers, "movie", 20),
    getTrendingByKind(providers, "kdrama", 20),
    getTrendingByKind(providers, "tv", 20),
    getLocalFiles(driver).catch(() => []),
  ]);

  const continueWatching: ContinueWatchingCard[] = progressEntries.map((entry) => ({
    item: entry.item,
    progress: entry.progress.percent,
    remainingSeconds: Math.max(
      0,
      entry.progress.durationSeconds - entry.progress.positionSeconds,
    ),
  }));

  const trending = interleave([anime.items, movies.items, kdrama.items, tv.items]);

  // Fall back to trending anime when there is no local library to surface.
  const recentlyAdded =
    localFiles.length > 0 ? recentlyAddedLocal(localFiles, 20) : anime.items.slice(0, 20);

  const tmdbReady = providers.get("tmdb")?.isAvailable() ?? false;

  if (trending.length === 0 && continueWatching.length === 0) {
    return (
      <div className="mx-auto max-w-2xl py-16">
        <EmptyState
          icon={<Compass className="size-5" />}
          title="Nothing to show yet"
          description={
            tmdbReady
              ? "Vestra could not reach any providers. Check your connection and try again."
              : "Add a TMDb key to your .env.local to unlock movies, TV and K-dramas. Anime works without any key."
          }
          action={
            <Button asChild variant="glass" size="sm">
              <Link href="/settings">
                <Settings className="size-4" />
                Open settings
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <HomeView
      continueWatching={continueWatching}
      trending={trending}
      recentlyAdded={recentlyAdded}
    />
  );
}
