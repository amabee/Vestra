import { anilist, tmdb } from "@vestra/api";
import { isTmdbConfigured } from "@vestra/config";
import { getContinueWatching } from "@vestra/core/continue-watching";
import { recentlyAddedLocal } from "@vestra/core/local-library";
import { getLocalFiles } from "@vestra/storage";
import type { MediaItem } from "@vestra/types";
import { Button, EmptyState } from "@vestra/ui";
import { Compass, Settings } from "lucide-react";
import Link from "next/link";

import { HomeView, type ContinueWatchingCard } from "@/components/home/home-view";
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
  const tmdbReady = isTmdbConfigured();

  const [progressEntries, anime, movies, kdrama, tv, localFiles] = await Promise.all([
    getContinueWatching(driver, 12).catch(() => []),
    anilist.getTrendingAnime(1, 20).catch(() => []),
    tmdbReady ? tmdb.getTrendingMovies("week").catch(() => []) : Promise.resolve([]),
    tmdbReady ? tmdb.getTrendingKdramas().catch(() => []) : Promise.resolve([]),
    tmdbReady ? tmdb.getTrendingTv("week").catch(() => []) : Promise.resolve([]),
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

  const trending = interleave([anime, movies, kdrama, tv]);

  // Fall back to popular anime when there's no local library to surface.
  const recentlyAdded =
    localFiles.length > 0
      ? recentlyAddedLocal(localFiles, 20)
      : await anilist.getPopularAnime(1, 20).catch(() => []);

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
