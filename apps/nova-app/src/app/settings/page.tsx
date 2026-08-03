import { isQbittorrentConfigured } from "@vestra/config";
import { getSettings } from "@vestra/storage";
import { Badge, GlassCard, SourceBadge } from "@vestra/ui";
import { Check, X } from "lucide-react";
import type { Metadata } from "next";

import { SettingsForm } from "@/components/settings/settings-form";
import { LibraryPanel } from "@/components/settings/library-panel";
import { getProviderRegistry } from "@/lib/registry";
import { getDriver } from "@/lib/storage";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/** Setup hint per provider, shown when it is not configured. */
const SETUP_HINT: Record<string, string> = {
  tmdb: "Set TMDB_ACCESS_TOKEN or TMDB_API_KEY.",
  anilist: "Public API — no key required.",
  youtube: "Set YOUTUBE_API_KEY.",
  mediaserver: "Set MEDIA_SERVER_KIND, MEDIA_SERVER_URL and MEDIA_SERVER_API_KEY.",
  local: "Folder scanning runs in Vestra Nova, the desktop app.",
};

export default async function SettingsPage() {
  const settings = await getSettings(getDriver());

  // Listed from the registry, so a newly registered provider appears here
  // automatically instead of needing another hard-coded row.
  const providers = getProviderRegistry()
    .all()
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      kinds: provider.kinds,
      capabilities: provider.capabilities,
      available: provider.isAvailable(),
      hint: SETUP_HINT[provider.id] ?? "",
    }));

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
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Providers</h2>
          <p className="text-xs text-muted-foreground">
            Content sources registered with Vestra. Each declares the kinds it serves and
            what it can do.
          </p>
        </div>

        <div className="space-y-2">
          {providers.map((provider) => (
            <GlassCard key={provider.id} className="flex items-start justify-between gap-4 p-4">
              <div className="min-w-0 space-y-1.5">
                <p className="text-sm font-medium">{provider.name}</p>

                <div className="flex flex-wrap items-center gap-1">
                  {provider.kinds.map((kind) => (
                    <SourceBadge key={kind} kind={kind} />
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  {provider.capabilities.search ? <span>search</span> : null}
                  {provider.capabilities.details ? <span>· details</span> : null}
                  {provider.capabilities.trending ? <span>· trending</span> : null}
                </div>

                {!provider.available && provider.hint ? (
                  <p className="text-xs text-muted-foreground">{provider.hint}</p>
                ) : null}
              </div>

              <Badge variant={provider.available ? "success" : "outline"} className="shrink-0">
                {provider.available ? <Check className="size-3" /> : <X className="size-3" />}
                {provider.available ? "Ready" : "Not configured"}
              </Badge>
            </GlassCard>
          ))}

          {/* qBittorrent is a transfer manager, not a catalogue provider. */}
          <GlassCard className="flex items-start justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">qBittorrent</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Transfer control only — not a search source. Set QBITTORRENT_URL,
                QBITTORRENT_USERNAME and QBITTORRENT_PASSWORD.
              </p>
            </div>
            <Badge
              variant={isQbittorrentConfigured() ? "success" : "outline"}
              className="shrink-0"
            >
              {isQbittorrentConfigured() ? (
                <Check className="size-3" />
              ) : (
                <X className="size-3" />
              )}
              {isQbittorrentConfigured() ? "Ready" : "Not configured"}
            </Badge>
          </GlassCard>
        </div>
      </section>

      <LibraryPanel />

      <SettingsForm initialSettings={settings} />
    </div>
  );
}
