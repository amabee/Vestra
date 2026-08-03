import { z } from "zod";

/**
 * Extension marketplace.
 *
 * Models a Seanime-compatible registry: a JSON array of entries, each pointing
 * at a manifest and (optionally) an executable payload.
 *
 * The registry is UNTRUSTED INPUT. Every entry is validated individually and
 * bad ones are dropped rather than failing the whole fetch, so a single
 * malformed record can't take out the page.
 */

export const EXTENSION_TYPES = [
  "plugin",
  "custom-source",
  "anime-torrent-provider",
  "onlinestream-provider",
  "manga-provider",
] as const;

export const extensionTypeSchema = z.enum(EXTENSION_TYPES);
export type ExtensionType = z.infer<typeof extensionTypeSchema>;

/**
 * Why a given extension type is or is not installable.
 *
 * Two different things get conflated if this is a bare boolean. `plugin` and
 * `custom-source` are supported and merely waiting on the sandbox. The three
 * provider types are not waiting on anything: they resolve content by scraping
 * sites that redistribute without a licence, which is the one thing Vestra has
 * decided not to do. Saying "no runtime for this yet" would imply a gap that
 * will be filled.
 */
export const EXTENSION_TYPE_SUPPORT: Record<
  ExtensionType,
  { supported: boolean; reason: string }
> = {
  plugin: { supported: true, reason: "" },
  "custom-source": { supported: true, reason: "" },
  "anime-torrent-provider": {
    supported: false,
    reason:
      "Vestra ships no trackers or indexers. It controls your own qBittorrent client, and what you point that at is your call — but it will not bundle the index for you.",
  },
  "onlinestream-provider": {
    supported: false,
    reason:
      "These play video by scraping sites that stream it without a licence from the rights holder. Vestra will not ship that — a deliberate choice, not a missing feature, so it is not coming in a later version either.",
  },
  "manga-provider": {
    supported: false,
    reason:
      "Same as online streaming: these scrape unlicensed reader sites. Vestra is a video app besides, with nowhere to put a chapter.",
  },
};

/** Types Vestra will actually run. Everything else is listed but inert. */
export const SUPPORTED_EXTENSION_TYPES: readonly ExtensionType[] = EXTENSION_TYPES.filter(
  (type) => EXTENSION_TYPE_SUPPORT[type].supported,
);

export const EXTENSION_TYPE_LABEL: Record<ExtensionType, string> = {
  plugin: "Plugins",
  "custom-source": "Custom Sources",
  "anime-torrent-provider": "Anime Torrents",
  "onlinestream-provider": "Online Streaming",
  "manga-provider": "Manga",
};

/** Loose on input, strict on output: registries vary in which fields they set. */
export const marketplaceEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().default("0.0.0"),
  author: z.string().default(""),
  description: z.string().default(""),
  type: extensionTypeSchema,
  /** Implementation language, e.g. "typescript". */
  language: z.string().default(""),
  /** Content language, e.g. "en", "multi". */
  lang: z.string().default("multi"),
  icon: z.string().default(""),
  manifestURI: z.string().default(""),
  /** Executable code. Separate from the manifest so metadata can be read alone. */
  payloadURI: z.string().default(""),
  website: z.string().default(""),

  /** VirusTotal summary, e.g. "0/61", or "Unscanned". */
  flags: z.string().default("Unscanned"),
  flaggedBy: z.array(z.string()).default([]),
  permalink: z.string().default(""),

  workingTag: z.boolean().default(false),
  brokenTag: z.boolean().default(false),
  deprecatedTag: z.boolean().default(false),
  official: z.boolean().default(false),

  tags: z.array(z.string()).default([]),
  scannedOnVersion: z.string().nullable().default(null),
  lastWorkingVersion: z.string().nullable().default(null),
  stars: z.number().default(0),
  addedAt: z.string().nullable().default(null),
  updatedAt: z.string().nullable().default(null),
});

export type MarketplaceEntry = z.infer<typeof marketplaceEntrySchema>;

/**
 * Parse a registry document, skipping entries that don't validate.
 * Returns the good entries plus a count of what was rejected.
 */
export function parseRegistry(input: unknown): {
  entries: MarketplaceEntry[];
  rejected: number;
} {
  if (!Array.isArray(input)) return { entries: [], rejected: 0 };

  const entries: MarketplaceEntry[] = [];
  let rejected = 0;

  for (const raw of input) {
    const parsed = marketplaceEntrySchema.safeParse(raw);
    if (parsed.success) entries.push(parsed.data);
    else rejected += 1;
  }

  return { entries, rejected };
}

/* =============================================================================
 * Health
 * ========================================================================== */

export type ExtensionHealth = "working" | "broken" | "deprecated" | "unknown";

export function healthOf(entry: MarketplaceEntry): ExtensionHealth {
  // Deprecated wins: a deprecated extension may still "work" but shouldn't be used.
  if (entry.deprecatedTag) return "deprecated";
  if (entry.brokenTag) return "broken";
  if (entry.workingTag) return "working";
  return "unknown";
}

/* =============================================================================
 * Trust
 * ========================================================================== */

export interface ScanResult {
  scanned: boolean;
  detections: number;
  engines: number;
}

/** Parse the VirusTotal summary string, e.g. "1/61". */
export function parseScan(flags: string): ScanResult {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(flags.trim());
  if (!match?.[1] || !match[2]) return { scanned: false, detections: 0, engines: 0 };

  const engines = Number.parseInt(match[2], 10);
  // "0/0" is a placeholder some registries use for unscanned entries.
  if (engines === 0) return { scanned: false, detections: 0, engines: 0 };

  return {
    scanned: true,
    detections: Number.parseInt(match[1], 10),
    engines,
  };
}

/**
 * Whether a payload URL points at an immutable ref.
 *
 * This is the weak link in registries of this shape: most payloads are served
 * from a mutable branch (`.../refs/heads/main/provider.ts`). Any malware scan
 * describes the file *at scan time*; whoever controls the repo can change it
 * afterwards and the recorded result stays green. Release assets and commit
 * SHAs cannot be swapped like that.
 */
export function isPinnedRef(url: string): boolean {
  if (url.length === 0) return false;

  // GitHub release assets are immutable once published.
  if (url.includes("/releases/download/")) return true;

  // A 40-character hex segment is a commit SHA.
  if (/\/[0-9a-f]{40}\//.test(url)) return true;

  // Explicit version tags, e.g. /v0.1.11/
  if (/\/v\d+\.\d+\.\d+\//.test(url)) return true;

  return false;
}

export interface TrustReport {
  supported: boolean;
  health: ExtensionHealth;
  scan: ScanResult;
  /** True when the payload comes from an immutable ref. */
  pinned: boolean;
  /** Has executable code at all. Manifest-only entries are inert. */
  hasPayload: boolean;
  /** Reasons the user should hesitate, worst first. */
  warnings: string[];
}

export function analyzeTrust(entry: MarketplaceEntry): TrustReport {
  const scan = parseScan(entry.flags);
  const health = healthOf(entry);
  const hasPayload = entry.payloadURI.length > 0;
  const pinned = isPinnedRef(entry.payloadURI);
  const supported = SUPPORTED_EXTENSION_TYPES.includes(entry.type);

  const warnings: string[] = [];

  if (scan.scanned && scan.detections > 0) {
    warnings.push(
      `Flagged by ${scan.detections} of ${scan.engines} scanners${
        entry.flaggedBy.length > 0 ? ` (${entry.flaggedBy.join(", ")})` : ""
      }.`,
    );
  }

  if (!scan.scanned) {
    warnings.push("Never scanned for malware.");
  }

  if (hasPayload && !pinned) {
    warnings.push(
      "Code is served from a mutable branch, so it can change after being scanned.",
    );
  }

  if (health === "broken") warnings.push("Reported broken by the registry.");
  if (health === "deprecated") warnings.push("Marked deprecated by its author.");

  return { supported, health, scan, pinned, hasPayload, warnings };
}

/* =============================================================================
 * Presentation helpers
 * ========================================================================== */

export type MarketplaceSort = "stars" | "updated" | "name";

export function sortEntries(
  entries: readonly MarketplaceEntry[],
  sort: MarketplaceSort,
): MarketplaceEntry[] {
  const copy = [...entries];

  switch (sort) {
    case "stars":
      return copy.sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name));
    case "updated":
      return copy.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    default:
      return copy.sort((a, b) => a.name.localeCompare(b.name));
  }
}

/** Distinct content languages present in a registry, for the filter dropdown. */
export function languagesOf(entries: readonly MarketplaceEntry[]): string[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    const value = entry.lang.trim().toLowerCase();
    if (value.length > 0) seen.add(value);
  }
  return [...seen].sort();
}
