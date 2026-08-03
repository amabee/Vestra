"use client";

import { analyzeTrust, EXTENSION_TYPE_SUPPORT, type MarketplaceEntry } from "@vestra/provider-sdk";
import { Badge, Button, cn, GlassCard } from "@vestra/ui";
import { Ban, Check, Download, Info, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  HealthBadge,
  OfficialBadge,
  PinnedBadge,
  ScanBadge,
  StarsBadge,
} from "./trust-badges";

interface ExtensionCardProps {
  entry: MarketplaceEntry;
  installed: boolean;
  busy: boolean;
  onInstall: (entry: MarketplaceEntry) => void;
  onUninstall: (entry: MarketplaceEntry) => void;
  onInspect: (entry: MarketplaceEntry) => void;
}

export function ExtensionCard({
  entry,
  installed,
  busy,
  onInstall,
  onUninstall,
  onInspect,
}: ExtensionCardProps) {
  const trust = analyzeTrust(entry);
  const risky = trust.warnings.length > 0;

  return (
    <GlassCard
      className={cn(
        "flex flex-col gap-3 p-4 transition-colors",
        !trust.supported && "opacity-70",
      )}
    >
      <div className="flex items-start gap-3">
        <ExtensionIcon entry={entry} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-sm font-semibold">{entry.name}</p>
            <OfficialBadge entry={entry} />
            <StarsBadge entry={entry} />
          </div>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{entry.id}</p>
        </div>
      </div>

      <p className="line-clamp-2 min-h-[2rem] text-xs leading-relaxed text-muted-foreground">
        {entry.description || "No description provided."}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary">v{entry.version}</Badge>
        {entry.author ? <Badge variant="outline">{entry.author}</Badge> : null}
        {entry.lang ? <Badge variant="outline">{entry.lang.toUpperCase()}</Badge> : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <HealthBadge entry={entry} />
        <ScanBadge entry={entry} />
        <PinnedBadge entry={entry} />
      </div>

      <div className="mt-auto flex items-center gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={() => onInspect(entry)} className="px-2">
          <Info className="size-3.5" />
          Details
        </Button>

        <div className="flex-1" />

        {!trust.supported ? (
          <Badge variant="outline" title={EXTENSION_TYPE_SUPPORT[entry.type].reason}>
            <Ban className="size-3" />
            Excluded
          </Badge>
        ) : installed ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onUninstall(entry)}
          >
            <Trash2 className="size-3.5" />
            Remove
          </Button>
        ) : (
          <Button
            variant={risky ? "outline" : "default"}
            size="sm"
            disabled={busy}
            onClick={() => onInstall(entry)}
          >
            <Download className="size-3.5" />
            Add
          </Button>
        )}
      </div>

      {installed ? (
        <p className="flex items-center gap-1.5 text-[11px] text-emerald-400">
          <Check className="size-3" />
          Added
        </p>
      ) : null}
    </GlassCard>
  );
}

/**
 * Icons are hosted on arbitrary third-party domains, so the request is sent
 * without a referrer and a broken URL degrades to an initial rather than a
 * broken-image glyph.
 */
function ExtensionIcon({ entry }: { entry: MarketplaceEntry }) {
  const [failed, setFailed] = useState(false);
  const usable = entry.icon.startsWith("https://") && !failed;

  if (!usable) {
    return (
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary/60 text-sm font-semibold text-muted-foreground">
        {entry.name.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={entry.icon}
      alt=""
      width={40}
      height={40}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="size-10 shrink-0 rounded-xl bg-secondary/60 object-cover"
    />
  );
}
