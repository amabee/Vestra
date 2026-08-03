"use client";

import type { MediaItem } from "@vestra/types";
import { Button } from "@vestra/ui";
import { Play } from "lucide-react";

import { useUiStore } from "@/stores/ui-store";

/**
 * Opens the player for an item.
 *
 * A client island so the details page can stay a Server Component while still
 * driving the player store.
 */
export function PlayButton({ item }: { item: MediaItem }) {
  const openPlayer = useUiStore((state) => state.openPlayer);

  return (
    <Button variant="default" onClick={() => openPlayer(item)}>
      <Play className="size-4 fill-current" />
      Play
    </Button>
  );
}
