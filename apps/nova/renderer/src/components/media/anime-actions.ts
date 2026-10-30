import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  mediaKey,
  type MediaItem,
  type PlaybackSource,
  type WatchProgress,
} from "@vestra/types";
import { bridge } from "@/lib/bridge";
import { usePlayer } from "@/lib/player-store";
import { keys } from "@/lib/queries";
import type { AnimeSourceEpisodes } from "../../../../shared/anime";

export function animeResume(
  item: MediaItem,
  queue: PlaybackSource[],
  progress: Record<string, WatchProgress>,
) {
  const saved = (entry: PlaybackSource) =>
    progress[`${mediaKey(item)}#${entry.progressId ?? entry.fileId ?? ""}`];
  const partial = queue
    .map((entry, index) => ({ entry, index, watch: saved(entry) }))
    .filter(
      (row) => row.watch && !row.watch.completed && row.watch.percent >= 0.01,
    )
    .sort((a, b) => (b.watch?.updatedAt ?? 0) - (a.watch?.updatedAt ?? 0))[0];
  return partial
    ? {
        index: partial.index,
        startAt: Math.floor(partial.watch!.positionSeconds),
      }
    : {
        index: Math.max(
          0,
          queue.findIndex((entry) => !saved(entry)?.completed),
        ),
        startAt: 0,
      };
}

export function useAnimeActions() {
  const cache = useQueryClient();
  const revision = useRef(0);
  useEffect(
    () => () => {
      revision.current++;
    },
    [],
  );
  const mutation = useMutation({
    mutationFn: async ({
      item,
      provider,
      resolved,
      resolve,
      refresh,
    }: {
      item: MediaItem;
      provider: string;
      resolved?: AnimeSourceEpisodes;
      refresh?: boolean;
      resolve?: () => Promise<AnimeSourceEpisodes>;
    }) => {
      const request = ++revision.current;
      if (!provider) throw Error("Choose an enabled anime source to play.");
      const [result, progress] = await Promise.all([
        resolved ??
          resolve?.() ??
          cache.fetchQuery({
            queryKey: ["anime-source-details", mediaKey(item), provider],
            queryFn: () => bridge.anime.open(provider, item),
            staleTime: refresh ? 0 : 30000,
          }),
        cache.fetchQuery({
          queryKey: keys.progress,
          queryFn: bridge.progress.all,
          staleTime: 0,
        }),
      ]);
      if (request !== revision.current) return;
      if (!result?.queue.length)
        throw Error(
          "No playable episodes matched. Open details or try the source matches below.",
        );
      const resume = animeResume(result.item, result.queue, progress);
      usePlayer
        .getState()
        .open(result.item, result.queue, resume.index, resume.startAt);
    },
  });
  const cancel = useCallback(() => {
    revision.current++;
    mutation.reset();
  }, [mutation.reset]);
  return { ...mutation, cancel };
}
