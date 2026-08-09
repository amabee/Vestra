import type { MediaKind } from "@vestra/types";

import type { StreamSourceProvider } from "./provider";

/**
 * Where stream sources are registered.
 *
 * Separate from `ProviderRegistry` in the provider SDK, and deliberately not
 * part of `createRegistries()`. That registry answers catalogue questions —
 * what to search, what to show on a category page, who owns a `MediaRef` — and
 * a stream source can answer none of them. Merging the two would put scrapers
 * in the catalogue and force every consumer to check which kind it received.
 *
 * The split is also the product boundary made structural: first-party
 * catalogues and community stream sources are different tiers of trust, and
 * a registry that cannot mix them cannot mix them by accident either.
 */
export class StreamSourceRegistry {
  private readonly sources = new Map<string, StreamSourceProvider>();
  /** Explicit user disables, kept independent of whether the source is loaded. */
  private readonly disabled = new Set<string>();

  register(source: StreamSourceProvider): this {
    if (this.sources.has(source.id)) {
      throw new Error(`Stream source "${source.id}" is already registered.`);
    }

    // Fail at registration rather than with a confusing failure mid-playback.
    for (const method of ["search", "getEpisodes", "getStreams"] as const) {
      if (typeof source[method] !== "function") {
        throw new Error(`Stream source "${source.id}" has no ${method}().`);
      }
    }

    this.sources.set(source.id, source);
    return this;
  }

  /** Safe to call for an id that was never registered. */
  unregister(id: string): boolean {
    return this.sources.delete(id);
  }

  get(id: string): StreamSourceProvider | undefined {
    return this.sources.get(id);
  }

  /** Every registered source, including disabled ones. */
  all(): StreamSourceProvider[] {
    return [...this.sources.values()];
  }

  setEnabled(id: string, enabled: boolean): void {
    if (enabled) this.disabled.delete(id);
    else this.disabled.add(id);
  }

  isEnabled(id: string): boolean {
    return !this.disabled.has(id);
  }

  /** Registered and not disabled by the user. */
  available(): StreamSourceProvider[] {
    return this.all().filter((source) => this.isEnabled(source.id));
  }

  /** Available sources that claim to carry a given kind. */
  supporting(kind: MediaKind): StreamSourceProvider[] {
    return this.available().filter((source) => source.kinds.includes(kind));
  }
}
