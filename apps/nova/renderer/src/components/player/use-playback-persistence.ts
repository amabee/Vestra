import { useCallback, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { mediaKey, type MediaItem } from "@vestra/types";
import { bridge } from "@/lib/bridge";
import { keys } from "@/lib/queries";

/** Session-owned snapshots prevent cleanup from saving a replacement episode. */
export function usePlaybackPersistence(input: {
  item: MediaItem | null;
  episodeId: string | null;
  episodeNumber: number | null;
  sessionId: number;
  position: number;
  duration: number;
  ready: boolean;
}) {
  const cache = useQueryClient();
  const {
    item,
    episodeId,
    episodeNumber,
    sessionId,
    position,
    duration,
    ready,
  } = input;
  const snapshot = useMemo(
    () => ({
      item,
      episodeId,
      episodeNumber,
      position: 0,
      duration: 0,
      checkedList: false,
    }),
    [item, episodeId, sessionId],
  );
  if (ready && duration > 0 && Number.isFinite(duration)) {
    snapshot.position = position;
    snapshot.duration = duration;
  }
  const persist = useCallback(() => {
    const {
      item: current,
      position: at,
      duration: total,
      episodeId,
      episodeNumber,
    } = snapshot;
    if (!current || total <= 0 || at <= 0) return;
    void bridge.progress
      .save({
        ref: current,
        episodeId,
        episodeNumber,
        positionSeconds: at,
        durationSeconds: total,
      })
      .then(async (saved) => {
        try {
          await bridge.history.add({
            item: current,
            episodeId,
            episodeNumber,
            positionSeconds: at,
            completed: saved.completed,
          });
          if (!snapshot.checkedList && saved.percent >= 0.01) {
            const list = await bridge.watchlist.list();
            if (
              list.find((row) => mediaKey(row.ref) === mediaKey(current))
                ?.status === "planned"
            ) {
              await bridge.watchlist.add(current, "watching");
              void cache.invalidateQueries({ queryKey: keys.watchlist });
            }
            snapshot.checkedList = true;
          }
        } finally {
          void cache.invalidateQueries({ queryKey: keys.progress });
          void cache.invalidateQueries({ queryKey: keys.history });
        }
      })
      .catch(() => undefined);
  }, [snapshot, cache]);
  useEffect(() => {
    if (!item) return;
    const timer = setInterval(persist, 15000);
    return () => {
      clearInterval(timer);
      persist();
    };
  }, [item, persist]);
  return persist;
}
