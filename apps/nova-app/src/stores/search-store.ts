"use client";

import { MAX_RECENT_SEARCHES } from "@vestra/config/constants";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SearchState {
  query: string;
  recent: string[];

  setQuery: (query: string) => void;
  addRecent: (query: string) => void;
  clearRecent: () => void;
}

export const useSearchStore = create<SearchState>()(
  persist(
    (set) => ({
      query: "",
      recent: [],

      setQuery: (query) => set({ query }),

      addRecent: (query) =>
        set((state) => {
          const trimmed = query.trim();
          if (trimmed.length === 0) return state;

          const deduped = state.recent.filter(
            (entry) => entry.toLowerCase() !== trimmed.toLowerCase(),
          );

          return { recent: [trimmed, ...deduped].slice(0, MAX_RECENT_SEARCHES) };
        }),

      clearRecent: () => set({ recent: [] }),
    }),
    {
      name: "vestra-search",
      partialize: (state) => ({ recent: state.recent }),
    },
  ),
);
