"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MediaItem, WatchlistEntry } from "@vestra/types";
import { Button } from "@vestra/ui";
import { Bookmark, BookmarkCheck, LoaderCircle } from "lucide-react";

import { toast } from "@/components/ui/toaster";

interface WatchlistResponse {
  entries: WatchlistEntry[];
}

async function fetchWatchlist(): Promise<WatchlistResponse> {
  const response = await fetch("/api/watchlist");
  if (!response.ok) throw new Error("Could not load watchlist");
  return (await response.json()) as WatchlistResponse;
}

async function toggle(item: MediaItem): Promise<{ inWatchlist: boolean }> {
  const response = await fetch("/api/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  if (!response.ok) throw new Error("Could not update watchlist");
  return (await response.json()) as { inWatchlist: boolean };
}

export function WatchlistButton({ item }: { item: MediaItem }) {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["watchlist"],
    queryFn: fetchWatchlist,
  });

  const inWatchlist =
    data?.entries.some(
      (entry) =>
        entry.ref.source === item.source &&
        entry.ref.kind === item.kind &&
        entry.ref.sourceId === item.sourceId,
    ) ?? false;

  const mutation = useMutation({
    mutationFn: () => toggle(item),
    // Refetch rather than patching locally — the server owns the canonical list.
    onSuccess: (result) => {
      toast(result.inWatchlist ? "Added to your watchlist" : "Removed from your watchlist");
      void queryClient.invalidateQueries({ queryKey: ["watchlist"] });
    },
    onError: () => toast("Could not update your watchlist", "error"),
  });

  return (
    <Button
      variant={inWatchlist ? "secondary" : "default"}
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      aria-pressed={inWatchlist}
    >
      {mutation.isPending ? (
        <LoaderCircle className="size-4 animate-spin" />
      ) : inWatchlist ? (
        <BookmarkCheck className="size-4" />
      ) : (
        <Bookmark className="size-4" />
      )}
      {inWatchlist ? "In Watchlist" : "Add to Watchlist"}
    </Button>
  );
}
