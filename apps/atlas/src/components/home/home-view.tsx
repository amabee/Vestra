"use client";

import { formatDuration } from "@vestra/core/format";
import type { MediaItem } from "@vestra/types";
import { cn } from "@vestra/ui";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

import { MediaRow, itemKey } from "@/components/media/media-row";
import { useUiStore } from "@/stores/ui-store";

import { HeroBanner } from "./hero-banner";

export interface ContinueWatchingCard {
  item: MediaItem;
  /** 0–1 fraction. */
  progress: number;
  remainingSeconds: number;
}

export interface HomeViewProps {
  continueWatching: ContinueWatchingCard[];
  trending: MediaItem[];
  recentlyAdded: MediaItem[];
}

const TABS = [
  { id: "all", label: "All" },
  { id: "anime", label: "Anime" },
  { id: "movie", label: "Movies" },
  { id: "kdrama", label: "K-Drama" },
  { id: "tv", label: "TV Shows" },
  { id: "youtube-video", label: "YouTube" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function HomeView({ continueWatching, trending, recentlyAdded }: HomeViewProps) {
  const [tab, setTab] = useState<TabId>("all");
  const selectedMedia = useUiStore((state) => state.selectedMedia);
  const setSelectedMedia = useUiStore((state) => state.setSelectedMedia);
  const openPlayer = useUiStore((state) => state.openPlayer);

  /** Continue Watching means resume — select it and start playing. */
  const resume = (item: MediaItem) => {
    setSelectedMedia(item);
    openPlayer(item);
  };

  // Seed the details panel with the first thing on the page so it isn't empty
  // on first load. Reads the live store value rather than subscribing, so an
  // existing user selection is never clobbered.
  useEffect(() => {
    if (useUiStore.getState().selectedMedia !== null) return;

    const seed = continueWatching[0]?.item ?? trending[0] ?? recentlyAdded[0] ?? null;
    if (seed) setSelectedMedia(seed);
  }, [continueWatching, trending, recentlyAdded, setSelectedMedia]);

  const availableTabs = useMemo(
    () =>
      TABS.filter(
        (entry) =>
          entry.id === "all" || trending.some((item) => item.kind === entry.id),
      ),
    [trending],
  );

  const filteredTrending = useMemo(
    () => (tab === "all" ? trending : trending.filter((item) => item.kind === tab)),
    [tab, trending],
  );

  const continueItems = continueWatching.map((entry) => entry.item);

  const progressByKey = Object.fromEntries(
    continueWatching.map((entry) => [itemKey(entry.item), entry.progress]),
  );

  const subtitleByKey = Object.fromEntries(
    continueWatching.map((entry) => {
      const remaining = formatDuration(entry.remainingSeconds);
      return [itemKey(entry.item), remaining ? `${remaining} left` : "In progress"];
    }),
  );

  const selectedKey = selectedMedia ? itemKey(selectedMedia) : null;

  const tabs = (
    <div className="flex flex-wrap items-center gap-1">
      {availableTabs.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => setTab(entry.id)}
          aria-pressed={tab === entry.id}
          className={cn(
            "relative rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors duration-200",
            tab === entry.id
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {/* Shared layoutId slides the pill between tabs instead of popping. */}
          {tab === entry.id ? (
            <motion.span
              layoutId="trending-tab"
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0 rounded-md bg-secondary"
            />
          ) : null}
          <span className="relative">{entry.label}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-7 pb-8">
      <HeroBanner items={trending} />

      <MediaRow
        title="Continue Watching"
        items={continueItems}
        variant="landscape"
        progressByKey={progressByKey}
        subtitleByKey={subtitleByKey}
        selectedKey={selectedKey}
        onSelect={resume}
        index={0}
      />

      <MediaRow
        title="Trending Now"
        items={filteredTrending}
        href="/discover"
        selectedKey={selectedKey}
        onSelect={setSelectedMedia}
        headerSlot={tabs}
        index={1}
      />

      <MediaRow
        title="Recently Added"
        items={recentlyAdded}
        href="/local"
        selectedKey={selectedKey}
        onSelect={setSelectedMedia}
        index={2}
      />
    </div>
  );
}
