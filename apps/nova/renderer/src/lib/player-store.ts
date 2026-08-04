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
  open: (item: MediaItem, queue: PlaybackSource[], index?: number) => void;
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

  open: (item, queue, index = 0) => set({ item, queue, index: clamp(index, queue.length) }),

  playAt: (index) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    set({ index });
  },

  next: () => {
    const { index, queue } = get();
    if (index + 1 < queue.length) set({ index: index + 1 });
  },

  previous: () => {
    const { index } = get();
    if (index > 0) set({ index: index - 1 });
  },

  close: () => set({ item: null, queue: [], index: 0 }),
}));

function clamp(index: number, length: number): number {
  if (length === 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}
