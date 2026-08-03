"use client";

import { PlayerOverlay } from "@/components/player/player-overlay";
import { SearchDialog } from "@/components/search/search-dialog";
import { Toaster } from "@/components/ui/toaster";
import { useUiStore } from "@/stores/ui-store";

import { DetailsPanel } from "./details-panel";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

/**
 * Application chrome: a full-width top bar above a sidebar / content / details
 * three-column body. The details panel only mounts when something is selected,
 * so pages like Settings get the full width.
 */
export function AppShell({
  children,
  extensionsEnabled,
}: {
  children: React.ReactNode;
  extensionsEnabled: boolean;
}) {
  const hasSelection = useUiStore((state) => state.selectedMedia !== null);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar />

      <div className="flex min-h-0 flex-1">
        <Sidebar extensionsEnabled={extensionsEnabled} />

        <main className="min-w-0 flex-1 overflow-y-auto px-6 py-5">{children}</main>

        {hasSelection ? <DetailsPanel /> : null}
      </div>

      <SearchDialog />
      <PlayerOverlay />
      <Toaster />
    </div>
  );
}
