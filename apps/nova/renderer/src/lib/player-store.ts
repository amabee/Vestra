import { create } from "zustand";
import type { MediaItem, PlaybackSource } from "@vestra/types";

/**
 * Player state.
 *
 * Global rather than routed: playback should survive navigation. Walking back
 * to the catalogue while something is playing is the normal case, not an edge
 * one, and tying the player to a route would tear it down on every click.
 */

interface PlayerState {
  item: MediaItem | null;
  source: PlaybackSource | null;
  open: (item: MediaItem, source: PlaybackSource) => void;
  close: () => void;
}

export const usePlayer = create<PlayerState>((set) => ({
  item: null,
  source: null,
  open: (item, source) => set({ item, source }),
  close: () => set({ item: null, source: null }),
}));
