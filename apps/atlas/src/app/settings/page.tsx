import {
  isAnilistConfigured,
  isMediaServerConfigured,
  isQbittorrentConfigured,
  isTmdbConfigured,
  isYoutubeConfigured,
} from "@vestra/config";
import { getSettings } from "@vestra/storage";
import { Badge, GlassCard } from "@vestra/ui";
import { Check, X } from "lucide-react";
import type { Metadata } from "next";

import { SettingsForm } from "@/components/settings/settings-form";
import { getDriver } from "@/lib/storage";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

interface ConnectionRow {
  name: string;
  connected: boolean;
  hint: string;
}

export default async function SettingsPage() {
  const settings = await getSettings(getDriver());

  const connections: ConnectionRow[] = [
    {
      name: "AniList",
      connected: isAnilistConfigured(),
      hint: "Public anime data. No API key required.",
    },
    {
      name: "TMDb",
      connected: isTmdbConfigured(),
      hint: "Movies, TV and K-drama. Set TMDB_ACCESS_TOKEN or TMDB_API_KEY.",
    },
    {
      name: "YouTube",
      connected: isYoutubeConfigured(),
      hint: "Video search and embedded playback. Set YOUTUBE_API_KEY.",
    },
    {
      name: "Media Server",
      connected: isMediaServerConfigured(),
      hint: "Your own Jellyfin server. Set MEDIA_SERVER_KIND, MEDIA_SERVER_URL and MEDIA_SERVER_API_KEY.",
    },
    {
      name: "qBittorrent",
      connected: isQbittorrentConfigured(),
      hint: "Transfer control. Set QBITTORRENT_URL, QBITTORRENT_USERNAME and QBITTORRENT_PASSWORD.",
    },
  ];

  return (
    <div className="max-w-3xl space-y-8 pb-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Connections are configured through environment variables and never stored in the
          browser.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Connections</h2>
        <div className="space-y-2">
          {connections.map((connection) => (
            <GlassCard
              key={connection.name}
              className="flex items-start justify-between gap-4 p-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{connection.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{connection.hint}</p>
              </div>
              <Badge
                variant={connection.connected ? "success" : "outline"}
                className="shrink-0"
              >
                {connection.connected ? (
                  <Check className="size-3" />
                ) : (
                  <X className="size-3" />
                )}
                {connection.connected ? "Connected" : "Not configured"}
              </Badge>
            </GlassCard>
          ))}
        </div>
      </section>

      <SettingsForm initialSettings={settings} />
    </div>
  );
}
