import type {
  MediaDetails,
  MediaItem,
  MediaKind,
  MediaRef,
  PlaybackSource,
  SearchQuery,
} from "@vestra/types";

/**
 * @vestra/provider-sdk — the contract every content source implements.
 *
 * The UI never talks to TMDb, AniList or YouTube directly. It talks to a
 * registry of providers, so adding a source is a registration rather than an
 * edit to shared code.
 *
 * Two distinct roles, deliberately kept apart:
 *
 *   MetadataProvider — describes content (search, details, trending)
 *   SourceAdapter    — resolves how content actually plays
 *
 * Separating them is what lets Vestra offer rich metadata for a film it cannot
 * legally stream, and still hand the user a working "open in source" action.
 */

/**
 * Provider identity.
 *
 * Typed as a plain string rather than the `MediaSource` union because
 * third-party extensions will contribute ids that cannot be known at compile
 * time. First-party providers use `MediaSource` values; `mediaSourceSchema`
 * will widen to a registry-validated string when extensions land.
 */
export type ProviderId = string;

/* =============================================================================
 * Host capabilities
 * ========================================================================== */

export type HostPlatform = "web" | "desktop" | "mobile";

/**
 * What the running host can actually do.
 *
 * Atlas and Nova can reach a filesystem and are the only hosts that will load
 * extensions. Pulse talks to Atlas over HTTP and has neither, so registering a
 * file-playback provider there would offer the user something that can never
 * work. The registry filters on this rather than each provider guessing.
 */
export interface HostCapabilities {
  platform: HostPlatform;
  /** Direct filesystem access — local library scanning and file playback. */
  filesystem: boolean;
  /** Can load third-party extension code in a sandbox. */
  extensions: boolean;
}

/** Declared by a provider or adapter; the registry excludes it when unmet. */
export interface HostRequirements {
  filesystem?: boolean;
  platforms?: readonly HostPlatform[];
}

export function hostSatisfies(
  host: HostCapabilities,
  requires: HostRequirements | undefined,
): boolean {
  if (!requires) return true;
  if (requires.filesystem && !host.filesystem) return false;
  if (requires.platforms && !requires.platforms.includes(host.platform)) return false;
  return true;
}

/** Hosts that can play files and stream locally; the only extension targets. */
export const FULL_HOST: HostCapabilities = {
  platform: "web",
  filesystem: true,
  extensions: true,
};

/** A thin client that consumes Atlas's API rather than providers directly. */
export const THIN_HOST: HostCapabilities = {
  platform: "mobile",
  filesystem: false,
  extensions: false,
};

/* =============================================================================
 * Execution context
 * ========================================================================== */

/**
 * Per-call context handed to every provider method.
 *
 * Providers must honour `signal` and stay within `timeoutMs` — the registry
 * enforces the budget anyway, but cooperating means work stops rather than
 * merely being ignored.
 */
export interface ProviderContext {
  /** Aborted when the caller gives up or the budget is exceeded. */
  signal: AbortSignal;
  timeoutMs: number;
  /** Cache lifetime hint in seconds. `0` means never cache. */
  revalidate?: number;
}

/* =============================================================================
 * Capabilities
 * ========================================================================== */

/**
 * What a provider can do.
 *
 * Declared rather than inferred from which methods exist, so the UI can render
 * a provider's abilities without probing it.
 */
export interface ProviderCapabilities {
  search: boolean;
  details: boolean;
  trending: boolean;
}

export interface ProviderSearchResult {
  items: MediaItem[];
  totalResults: number;
  hasMore: boolean;
}

/* =============================================================================
 * Metadata providers
 * ========================================================================== */

export interface MetadataProvider {
  readonly id: ProviderId;
  /** Human-readable name, shown as the search result group heading. */
  readonly name: string;
  /** Content kinds this provider can return. Drives filtering and routing. */
  readonly kinds: readonly MediaKind[];
  readonly capabilities: ProviderCapabilities;
  /** Host features this provider depends on. Omit when it works anywhere. */
  readonly requires?: HostRequirements;

  /**
   * Whether the provider is usable right now — API key present, server
   * reachable, feature enabled. Unavailable providers are skipped silently
   * instead of producing errors the user cannot act on.
   */
  isAvailable(): boolean;

  /** Required when `capabilities.search` is true. */
  search?(query: SearchQuery, context: ProviderContext): Promise<ProviderSearchResult>;

  /**
   * Required when `capabilities.details` is true.
   *
   * Takes a full `MediaRef`, not a bare id: ids are only unique within a
   * provider *and* kind. TMDb id 603 is both a film and a series.
   */
  getDetails?(ref: MediaRef, context: ProviderContext): Promise<MediaDetails | null>;

  /** Required when `capabilities.trending` is true. */
  getTrending?(kind: MediaKind, context: ProviderContext): Promise<MediaItem[]>;
}

/* =============================================================================
 * Source adapters (playback)
 * ========================================================================== */

/**
 * Resolves playable sources for an item.
 *
 * Returns `PlaybackSource[]` rather than a bare URL because a locator alone
 * cannot express *how* to play it — a YouTube embed, an HTTP stream, a local
 * file and an external deep link each need different handling in the player.
 * Adapters return an empty array when they cannot help.
 */
export interface SourceAdapter {
  readonly id: string;
  readonly name: string;
  /** Host features this adapter depends on. Omit when it works anywhere. */
  readonly requires?: HostRequirements;
  /** Cheap synchronous pre-filter; avoids waking adapters that cannot help. */
  canHandle(item: MediaItem): boolean;
  isAvailable(): boolean;
  resolve(item: MediaItem, context: ProviderContext): Promise<PlaybackSource[]>;
}

/* =============================================================================
 * Extension manifest (V3 — not yet loaded at runtime)
 * ========================================================================== */

/**
 * Shape a third-party extension will declare.
 *
 * Defined now so the SDK contract is stable before any loader exists.
 * Untrusted code must never run in the renderer or the Next.js server process;
 * the eventual loader will run extensions in a worker with the permissions
 * declared here brokered by the host.
 */
export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  /** Entry module, relative to the extension root. */
  main: string;
  /** Minimum SDK version the extension was built against. */
  sdkVersion: string;
  permissions: ExtensionPermission[];
  author?: string;
  homepage?: string;
  description?: string;
}

export type ExtensionPermission =
  /** Outbound HTTP. Hosts are allow-listed by the loader. */
  | "network"
  /** Read the user's local library index. */
  | "library:read"
  /** Read stored playback progress. */
  | "progress:read";
