import { create } from "zustand";
import type { MediaItem, PlaybackSource } from "@vestra/types";

/**
 * Player state.
 *
 * Global rather than routed: playback should survive navigation. Walking back
 * to the catalogue while something is playing is the normal case, not an edge
 * one, and tying the player to a route would tear it down on every click.
 *
 * The whole queue is held rather than a single source, because "next episode"
 * has to come from somewhere. For a series the queue is every file the adapter
 * resolved, already ordered by season and episode; for a film it is a queue of
 * one, and the navigation controls simply have nowhere to go.
 */

interface PlayerState {
  item: MediaItem | null;
  queue: PlaybackSource[];
  index: number;
  /**
   * Where to start the file that is about to open.
   *
   * Only set when the caller has an opinion — "Resume" and "Start over" from
   * the episode list. Left null the rest of the time so the player falls back
   * to whatever progress it has stored, which is what autoplaying the next
   * episode should do.
   */
  startAt: number | null;
  /**
   * Which playback this is, counting up.
   *
   * Title and queue position do not distinguish replaying the same episode
   * from never having left it, and the controls window needs to tell those
   * apart — an opening already skipped once must be skipped again next time
   * the file is opened.
   */
  sessionId: number;
  open: (
    item: MediaItem,
    queue: PlaybackSource[],
    index?: number,
    startAt?: number | null,
  ) => void;
  /** Jump to a position in the queue, ignoring anything out of range. */
  playAt: (index: number) => void;
  next: () => void;
  previous: () => void;
  close: () => void;
}

export const usePlayer = create<PlayerState>((set, get) => ({
  item: null,
  queue: [],
  index: 0,
  startAt: null,
  sessionId: 0,

  open: (item, queue, index = 0, startAt = null) =>
    set((state) => ({
      item,
      queue,
      index: clamp(index, queue.length),
      startAt,
      sessionId: state.sessionId + 1,
    })),

  playAt: (index) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    set((state) => ({ index, startAt: null, sessionId: state.sessionId + 1 }));
  },

  next: () => {
    const { index, queue } = get();
    if (index + 1 < queue.length) {
      set((state) => ({
        index: index + 1,
        startAt: null,
        sessionId: state.sessionId + 1,
      }));
    }
  },

  previous: () => {
    const { index } = get();
    if (index > 0) {
      set((state) => ({
        index: index - 1,
        startAt: null,
        sessionId: state.sessionId + 1,
      }));
    }
  },

  close: () => set({ item: null, queue: [], index: 0, startAt: null }),
}));

function clamp(index: number, length: number): number {
  if (length === 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}
