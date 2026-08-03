import type { Metadata } from "next";

import { DownloadsClient } from "@/components/downloads/downloads-client";

export const metadata: Metadata = { title: "Downloads" };

export default function DownloadsPage() {
  return (
    <div className="space-y-6 pb-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Downloads</h1>
        <p className="text-sm text-muted-foreground">
          Transfers in your own qBittorrent client. Vestra only controls the client — it
          ships no trackers or indexers.
        </p>
      </div>

      <DownloadsClient />
    </div>
  );
}
