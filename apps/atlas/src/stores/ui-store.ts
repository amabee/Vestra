"use client";

import type { MediaItem } from "@vestra/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Client-side UI state.
 *
 * Only the sidebar is persisted. Durable data (settings, watchlist, progress)
 * lives server-side in JSON — this store is ephemeral chrome.
 */

interface UiState {
  sidebarCollapsed: boolean;
  searchOpen: boolean;
  /** Item currently shown in the right-hand details panel. */
  selectedMedia: MediaItem | null;
  /** Item currently open in the full-screen player. */
  playerItem: MediaItem | null;

  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  toggleSearch: () => void;
  setSelectedMedia: (item: MediaItem | null) => void;
  openPlayer: (item: MediaItem) => void;
  closePlayer: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      searchOpen: false,
      selectedMedia: null,
      playerItem: null,

      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setSearchOpen: (searchOpen) => set({ searchOpen }),
      toggleSearch: () => set((state) => ({ searchOpen: !state.searchOpen })),
      setSelectedMedia: (selectedMedia) => set({ selectedMedia }),
      openPlayer: (playerItem) => set({ playerItem }),
      closePlayer: () => set({ playerItem: null }),
    }),
    {
      name: "vestra-ui",
      // Never restore the search dialog or a stale selection on load.
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
    },
  ),
);
