"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatBytes, formatEta, formatSpeed, toPercent } from "@vestra/core/format";
import type { QbittorrentStatus, Torrent } from "@vestra/types";
import { Badge, Button, EmptyState, GlassCard, ProgressBar } from "@vestra/ui";
import { Download, Pause, Play, Plus, TriangleAlert } from "lucide-react";
import { useState } from "react";

interface DownloadsResponse {
  configured: boolean;
  status?: QbittorrentStatus | null;
  torrents: Torrent[];
  error?: string;
}

async function fetchDownloads(): Promise<DownloadsResponse> {
  const response = await fetch("/api/downloads");
  const payload = (await response.json()) as DownloadsResponse;
  if (!response.ok && response.status !== 502) {
    throw new Error(payload.error ?? "Could not load transfers");
  }
  return payload;
}

const STATE_VARIANT: Record<Torrent["state"], "default" | "success" | "warning" | "danger" | "secondary"> = {
  downloading: "default",
  seeding: "success",
  completed: "success",
  paused: "secondary",
  queued: "secondary",
  checking: "warning",
  stalled: "warning",
  error: "danger",
  unknown: "secondary",
};

export function DownloadsClient() {
  const queryClient = useQueryClient();
  const [magnet, setMagnet] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["downloads"],
    queryFn: fetchDownloads,
    // Transfers change constantly; poll rather than relying on cache.
    refetchInterval: 3000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["downloads"] });

  const action = useMutation({
    mutationFn: async (input: { action: "pause" | "resume" | "delete"; hashes: string[] }) => {
      const response = await fetch("/api/downloads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error("Action failed");
    },
    onSuccess: invalidate,
  });

  const add = useMutation({
    mutationFn: async (url: string) => {
      const response = await fetch("/api/downloads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: [url], paused: false }),
      });
      if (!response.ok) throw new Error("Could not add transfer");
    },
    onSuccess: () => {
      setMagnet("");
      invalidate();
    },
  });

  if (isLoading) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Loading transfers…</p>;
  }

  if (!data?.configured) {
    return (
      <EmptyState
        icon={<Download className="size-5" />}
        title="qBittorrent is not connected"
        description="Set QBITTORRENT_URL, QBITTORRENT_USERNAME and QBITTORRENT_PASSWORD in your .env.local, and enable the Web UI in qBittorrent under Tools › Options › Web UI."
      />
    );
  }

  if (data.error) {
    return (
      <EmptyState
        icon={<TriangleAlert className="size-5" />}
        title="Could not reach qBittorrent"
        description={data.error}
      />
    );
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (magnet.trim().length > 0) add.mutate(magnet.trim());
        }}
        className="flex gap-2"
      >
        <input
          value={magnet}
          onChange={(event) => setMagnet(event.target.value)}
          placeholder="Paste a magnet link or .torrent URL"
          className="h-10 flex-1 rounded-xl border border-border bg-secondary/40 px-3.5 text-sm outline-none transition-colors focus:border-primary/50"
        />
        <Button type="submit" disabled={add.isPending || magnet.trim().length === 0}>
          <Plus className="size-4" />
          Add
        </Button>
      </form>

      {data.torrents.length === 0 ? (
        <EmptyState
          icon={<Download className="size-5" />}
          title="No active transfers"
          description="Transfers added to your qBittorrent client will appear here."
        />
      ) : (
        <div className="space-y-2">
          {data.torrents.map((torrent) => {
            const isPaused = torrent.state === "paused";

            return (
              <GlassCard key={torrent.hash} className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={torrent.name}>
                      {torrent.name}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={STATE_VARIANT[torrent.state]} className="capitalize">
                        {torrent.state}
                      </Badge>
                      <span>{formatBytes(torrent.sizeBytes)}</span>
                      <span>↓ {formatSpeed(torrent.downloadSpeed)}</span>
                      <span>↑ {formatSpeed(torrent.uploadSpeed)}</span>
                      {torrent.etaSeconds ? <span>ETA {formatEta(torrent.etaSeconds)}</span> : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={isPaused ? "Resume" : "Pause"}
                      disabled={action.isPending}
                      onClick={() =>
                        action.mutate({
                          action: isPaused ? "resume" : "pause",
                          hashes: [torrent.hash],
                        })
                      }
                    >
                      {isPaused ? <Play className="size-4" /> : <Pause className="size-4" />}
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <ProgressBar value={torrent.progress} className="flex-1" />
                  <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {toPercent(torrent.progress)}%
                  </span>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
