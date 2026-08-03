"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import type { PlaybackSource, WatchProgress } from "@vestra/types";
import { Button, cn } from "@vestra/ui";
import { ExternalLink, LoaderCircle, TriangleAlert, X } from "lucide-react";

import { YoutubePlayer } from "@/components/media/youtube-player";
import { useUiStore } from "@/stores/ui-store";

import { VideoPlayer } from "./video-player";

/**
 * Full-screen player overlay.
 *
 * Resolves playable sources server-side, resumes from stored progress, and
 * degrades honestly: metadata-only items (TMDb / AniList) have no stream, so
 * the overlay explains that and offers a deep link instead of a dead player.
 */
export function PlayerOverlay() {
  const item = useUiStore((state) => state.playerItem);
  const closePlayer = useUiStore((state) => state.closePlayer);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["playback", item?.source, item?.kind, item?.sourceId],
    queryFn: async () => {
      const response = await fetch(
        `/api/playback/${item!.source}/${item!.kind}/${encodeURIComponent(item!.sourceId)}`,
      );
      if (!response.ok) throw new Error("Could not resolve playback");
      return (await response.json()) as { sources: PlaybackSource[] };
    },
    enabled: item !== null,
  });

  const { data: progressData } = useQuery({
    queryKey: ["progress"],
    queryFn: async () => {
      const response = await fetch("/api/progress");
      if (!response.ok) throw new Error("Could not load progress");
      return (await response.json()) as { entries: Record<string, WatchProgress> };
    },
    enabled: item !== null,
  });

  if (!item) return null;

  const best = data?.sources[0] ?? null;
  const external = data?.sources.find((source) => source.kind === "external") ?? null;

  const progressKey = `${item.source}:${item.kind}:${item.sourceId}`;
  const stored = progressData?.entries[progressKey];
  const startAt = stored && !stored.completed ? stored.positionSeconds : 0;

  const mediaRef = { source: item.source, kind: item.kind, sourceId: item.sourceId };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && closePlayer()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />

        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[min(78rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
        >
          <Dialog.Title className="sr-only">{item.title}</Dialog.Title>

          <Dialog.Close
            aria-label="Close player"
            className="absolute -top-11 right-0 flex size-9 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <X className="size-4" />
          </Dialog.Close>

          {isLoading ? (
            <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-black">
              <LoaderCircle className="size-6 animate-spin text-white/60" />
            </div>
          ) : isError ? (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl bg-black text-center">
              <TriangleAlert className="size-6 text-amber-400" />
              <p className="text-sm text-white/80">Could not resolve a playable source.</p>
            </div>
          ) : best?.kind === "youtube" ? (
            <YoutubePlayer videoId={best.locator} title={item.title} />
          ) : best?.kind === "file" || best?.kind === "stream" ? (
            <VideoPlayer
              src={best.locator}
              mimeType={best.mimeType}
              title={item.title}
              mediaRef={mediaRef}
              startAt={startAt}
            />
          ) : (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-4 rounded-xl bg-black px-8 text-center">
              <TriangleAlert className="size-7 text-amber-400" />
              <div className="space-y-1.5">
                <p className="text-[15px] font-medium text-white">
                  No playable source for this title
                </p>
                <p className="max-w-md text-[13px] leading-relaxed text-white/60">
                  Vestra has metadata for “{item.title}” but no stream. Add it to your media
                  server or local library to play it here.
                </p>
              </div>

              {external ? (
                <Button asChild variant="glass" size="sm">
                  <a href={external.locator} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-4" />
                    Open in source
                  </a>
                </Button>
              ) : null}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
