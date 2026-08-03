"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  analyzeTrust,
  EXTENSION_TYPE_LABEL,
  EXTENSION_TYPE_SUPPORT,
  type MarketplaceEntry,
} from "@vestra/provider-sdk";
import { Badge, Button } from "@vestra/ui";
import { Ban, Download, ExternalLink, Trash2, TriangleAlert } from "lucide-react";

import {
  HealthBadge,
  OfficialBadge,
  PinnedBadge,
  ScanBadge,
} from "./trust-badges";

interface ExtensionDetailsProps {
  entry: MarketplaceEntry | null;
  installed: boolean;
  onClose: () => void;
  onInstall: (entry: MarketplaceEntry) => void;
  onUninstall: (entry: MarketplaceEntry) => void;
}

/** Full record for one extension, including everything the registry claims. */
export function ExtensionDetails({
  entry,
  installed,
  onClose,
  onInstall,
  onUninstall,
}: ExtensionDetailsProps) {
  return (
    <Dialog.Root open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="glass fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col gap-5 overflow-y-auto border-l border-border p-6 shadow-lifted focus:outline-none">
          {entry ? (
            <DetailsBody
              entry={entry}
              installed={installed}
              onInstall={onInstall}
              onUninstall={onUninstall}
            />
          ) : (
            <Dialog.Title className="sr-only">Extension details</Dialog.Title>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DetailsBody({
  entry,
  installed,
  onInstall,
  onUninstall,
}: {
  entry: MarketplaceEntry;
  installed: boolean;
  onInstall: (entry: MarketplaceEntry) => void;
  onUninstall: (entry: MarketplaceEntry) => void;
}) {
  const trust = analyzeTrust(entry);

  // Registries use `tags` for both human labels and internal ids (Discord
  // snowflakes, for one). Only the readable ones are worth showing.
  const tags = entry.tags.filter((tag) => !/^\d+$/.test(tag));

  return (
    <>
      <div className="space-y-2">
        <Dialog.Title className="text-lg font-semibold tracking-tight">
          {entry.name}
        </Dialog.Title>
        <p className="font-mono text-[11px] text-muted-foreground">{entry.id}</p>
        <Dialog.Description className="text-xs leading-relaxed text-muted-foreground">
          {entry.description || "No description provided."}
        </Dialog.Description>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary">{EXTENSION_TYPE_LABEL[entry.type]}</Badge>
        <OfficialBadge entry={entry} />
        <HealthBadge entry={entry} />
        <ScanBadge entry={entry} />
        <PinnedBadge entry={entry} />
      </div>

      {trust.warnings.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
            <TriangleAlert className="size-3.5" />
            Before you install
          </p>
          <ul className="space-y-1 text-[11px] leading-relaxed text-amber-200/80">
            {trust.warnings.map((warning) => (
              <li key={warning}>— {warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!trust.supported ? (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-secondary/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
          <Ban className="mt-0.5 size-3.5 shrink-0" />
          <span>{EXTENSION_TYPE_SUPPORT[entry.type].reason}</span>
        </div>
      ) : null}

      <dl className="space-y-2 text-xs">
        <Row label="Version" value={entry.version} />
        <Row label="Author" value={entry.author || "—"} />
        <Row label="Language" value={entry.language || "—"} />
        <Row label="Content language" value={entry.lang.toUpperCase()} />
        <Row label="Stars" value={entry.stars > 0 ? String(entry.stars) : "—"} />
        <Row label="Last known working" value={entry.lastWorkingVersion ?? "—"} />
        <Row label="Scanned on version" value={entry.scannedOnVersion ?? "—"} />
        <Row label="Added" value={formatDate(entry.addedAt)} />
        <Row label="Updated" value={formatDate(entry.updatedAt)} />
      </dl>

      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <LinkRow label="Website" href={entry.website} />
        <LinkRow label="Manifest" href={entry.manifestURI} />
        <LinkRow label="Source code" href={entry.payloadURI} />
        <LinkRow label="Scan report" href={entry.permalink} />
      </div>

      <div className="mt-auto flex items-center gap-2 pt-2">
        <Dialog.Close asChild>
          <Button variant="ghost" size="sm">
            Close
          </Button>
        </Dialog.Close>

        <div className="flex-1" />

        {trust.supported ? (
          installed ? (
            <Button variant="outline" size="sm" onClick={() => onUninstall(entry)}>
              <Trash2 className="size-3.5" />
              Remove
            </Button>
          ) : (
            <Button
              // Warnings are not a block, but they should not be overridden by a
              // primary-coloured call to action either.
              variant={trust.warnings.length > 0 ? "outline" : "default"}
              size="sm"
              onClick={() => onInstall(entry)}
            >
              <Download className="size-3.5" />
              {trust.warnings.length > 0 ? "Add anyway" : "Add extension"}
            </Button>
          )
        ) : null}
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/50 pb-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-medium">{value}</dd>
    </div>
  );
}

/** Only http(s) links are rendered, so a crafted entry cannot inject javascript:. */
function LinkRow({ label, href }: { label: string; href: string }) {
  if (!href.startsWith("https://") && !href.startsWith("http://")) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
    >
      <span>{label}</span>
      <ExternalLink className="size-3.5 shrink-0" />
    </a>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
