"use client";

import {
  analyzeTrust,
  healthOf,
  type MarketplaceEntry,
  parseScan,
} from "@vestra/provider-sdk";
import { Badge } from "@vestra/ui";
import {
  BadgeCheck,
  CircleSlash,
  GitBranch,
  Lock,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  Star,
  TriangleAlert,
} from "lucide-react";

/**
 * Trust indicators.
 *
 * Registries of this shape already carry health tags, malware-scan results and
 * star counts, but stores built on them typically show none of it. Surfacing
 * it is the whole point of this view: the decision to run third-party code is
 * the user's, and they can only make it with the evidence in front of them.
 */

const HEALTH_STYLE = {
  working: { variant: "success" as const, label: "Working", Icon: ShieldCheck },
  broken: { variant: "danger" as const, label: "Broken", Icon: ShieldAlert },
  deprecated: { variant: "warning" as const, label: "Deprecated", Icon: CircleSlash },
  unknown: { variant: "outline" as const, label: "Unverified", Icon: TriangleAlert },
};

export function HealthBadge({ entry }: { entry: MarketplaceEntry }) {
  const { variant, label, Icon } = HEALTH_STYLE[healthOf(entry)];
  return (
    <Badge variant={variant}>
      <Icon className="size-3" />
      {label}
    </Badge>
  );
}

export function ScanBadge({ entry }: { entry: MarketplaceEntry }) {
  const scan = parseScan(entry.flags);

  if (!scan.scanned) {
    return (
      <Badge variant="outline" title="This extension has never been scanned for malware.">
        <ScanLine className="size-3" />
        Unscanned
      </Badge>
    );
  }

  const clean = scan.detections === 0;

  return (
    <Badge
      variant={clean ? "success" : "danger"}
      title={
        clean
          ? `No detections across ${scan.engines} scanners.`
          : `Flagged by ${entry.flaggedBy.join(", ") || "one or more scanners"}.`
      }
    >
      <ScanLine className="size-3" />
      {scan.detections}/{scan.engines}
    </Badge>
  );
}

/**
 * Whether the scanned artefact can still be swapped out.
 *
 * A clean scan of a file on a mutable branch says nothing about the file you
 * will actually download tomorrow.
 */
export function PinnedBadge({ entry }: { entry: MarketplaceEntry }) {
  const { hasPayload, pinned } = analyzeTrust(entry);
  if (!hasPayload) return null;

  return pinned ? (
    <Badge variant="secondary" title="Served from a release or commit that cannot change.">
      <Lock className="size-3" />
      Pinned
    </Badge>
  ) : (
    <Badge
      variant="warning"
      title="Served from a branch. The code can be changed at any time, after any scan."
    >
      <GitBranch className="size-3" />
      Mutable
    </Badge>
  );
}

export function OfficialBadge({ entry }: { entry: MarketplaceEntry }) {
  if (!entry.official) return null;
  return (
    <Badge variant="electric" title="Published by the registry maintainers.">
      <BadgeCheck className="size-3" />
      Official
    </Badge>
  );
}

export function StarsBadge({ entry }: { entry: MarketplaceEntry }) {
  if (entry.stars <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <Star className="size-3" />
      {entry.stars}
    </span>
  );
}
