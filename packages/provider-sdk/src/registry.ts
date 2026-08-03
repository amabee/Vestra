import type { MediaItem, MediaKind, MediaRef } from "@vestra/types";

import {
  hostSatisfies,
  type HostCapabilities,
  type MetadataProvider,
  type ProviderId,
  type SourceAdapter,
} from "./types";

/**
 * Registries for metadata providers and playback source adapters.
 *
 * Registration replaces the hard-coded provider switch that used to live in
 * `@vestra/core`, so a new source no longer means editing shared code.
 *
 * Both registries are host-aware: a provider that needs a filesystem is simply
 * never offered on a host that lacks one.
 */

export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, MetadataProvider>();
  /** Explicit user disables, independent of `isAvailable()`. */
  private readonly disabled = new Set<ProviderId>();
  private readonly host: HostCapabilities;

  constructor(host: HostCapabilities) {
    this.host = host;
  }

  register(provider: MetadataProvider): this {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider "${provider.id}" is already registered.`);
    }

    // Fail loudly at registration rather than with a confusing runtime crash.
    if (provider.capabilities.search && typeof provider.search !== "function") {
      throw new Error(`Provider "${provider.id}" declares search but has no search().`);
    }
    if (provider.capabilities.details && typeof provider.getDetails !== "function") {
      throw new Error(`Provider "${provider.id}" declares details but has no getDetails().`);
    }
    if (provider.capabilities.trending && typeof provider.getTrending !== "function") {
      throw new Error(
        `Provider "${provider.id}" declares trending but has no getTrending().`,
      );
    }

    this.providers.set(provider.id, provider);
    return this;
  }

  unregister(id: ProviderId): boolean {
    return this.providers.delete(id);
  }

  get(id: ProviderId): MetadataProvider | undefined {
    return this.providers.get(id);
  }

  /** Every registered provider, including unavailable and disabled ones. */
  all(): MetadataProvider[] {
    return [...this.providers.values()];
  }

  setEnabled(id: ProviderId, enabled: boolean): void {
    if (enabled) this.disabled.delete(id);
    else this.disabled.add(id);
  }

  isEnabled(id: ProviderId): boolean {
    return !this.disabled.has(id);
  }

  /** Registered, supported by this host, configured and not disabled. */
  available(): MetadataProvider[] {
    return this.all().filter(
      (provider) =>
        hostSatisfies(this.host, provider.requires) &&
        this.isEnabled(provider.id) &&
        provider.isAvailable(),
    );
  }

  searchable(): MetadataProvider[] {
    return this.available().filter((provider) => provider.capabilities.search);
  }

  /** Providers that can return a given kind — powers the category pages. */
  supporting(kind: MediaKind): MetadataProvider[] {
    return this.available().filter((provider) => provider.kinds.includes(kind));
  }

  /** The provider that owns a ref, if it is registered and usable. */
  forRef(ref: MediaRef): MetadataProvider | undefined {
    const provider = this.providers.get(ref.source);
    if (
      !provider ||
      !hostSatisfies(this.host, provider.requires) ||
      !this.isEnabled(provider.id) ||
      !provider.isAvailable()
    ) {
      return undefined;
    }
    return provider;
  }
}

/* =============================================================================
 * Source adapters
 * ========================================================================== */

export class SourceAdapterRegistry {
  private readonly adapters = new Map<string, SourceAdapter>();
  private readonly host: HostCapabilities;

  constructor(host: HostCapabilities) {
    this.host = host;
  }

  register(adapter: SourceAdapter): this {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Source adapter "${adapter.id}" is already registered.`);
    }
    this.adapters.set(adapter.id, adapter);
    return this;
  }

  unregister(id: string): boolean {
    return this.adapters.delete(id);
  }

  all(): SourceAdapter[] {
    return [...this.adapters.values()];
  }

  /** Adapters supported by this host, configured, and claiming the item. */
  forItem(item: MediaItem): SourceAdapter[] {
    return this.all().filter(
      (adapter) =>
        hostSatisfies(this.host, adapter.requires) &&
        adapter.isAvailable() &&
        adapter.canHandle(item),
    );
  }
}
