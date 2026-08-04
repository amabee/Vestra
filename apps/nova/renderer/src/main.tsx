import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router";

import { AppShell } from "@/components/chrome/app-shell";
import { BrowseRoute } from "@/routes/browse";
import {
  HistoryRoute,
  LibraryRoute,
  SearchRoute,
  WatchlistRoute,
} from "@/routes/collections";
import { HomeRoute } from "@/routes/home";
import { ExtensionsRoute, SettingsRoute } from "@/routes/system";

import "@/styles/theme.css";

/**
 * Renderer entry.
 *
 * Hash routing, not browser history: the app is loaded from a `file://` URL in
 * production, where path-based routing resolves against the filesystem and
 * breaks on the first refresh.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Everything arrives over IPC from a local process; refetching on focus
      // is web-app behaviour that buys nothing here.
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
});

const router = createHashRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <HomeRoute /> },
      {
        path: "anime",
        element: (
          <BrowseRoute
            kind="anime"
            title="Anime"
            lead="Seasonal and trending, straight from AniList."
          />
        ),
      },
      {
        path: "films",
        element: (
          <BrowseRoute
            kind="movie"
            title="Films"
            lead="Feature films, catalogued from the sources you have configured."
          />
        ),
      },
      {
        path: "series",
        element: (
          <BrowseRoute
            kind="tv"
            title="Series"
            lead="Television and long-form, across every configured source."
          />
        ),
      },
      { path: "library", element: <LibraryRoute /> },
      { path: "watchlist", element: <WatchlistRoute /> },
      { path: "history", element: <HistoryRoute /> },
      { path: "extensions", element: <ExtensionsRoute /> },
      { path: "settings", element: <SettingsRoute /> },
      { path: "search", element: <SearchRoute /> },
    ],
  },
]);

const container = document.querySelector("#root");
if (!container) throw new Error("Root element is missing from index.html.");

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
