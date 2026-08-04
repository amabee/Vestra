import {
  FULL_HOST,
  ProviderRegistry,
  SourceAdapterRegistry,
  type HostCapabilities,
} from "@vestra/provider-sdk";
import type { StorageDriver } from "@vestra/storage";
import type { MediaDetails, MediaItem } from "@vestra/types";

import {
  createExternalAdapter,
  createLocalFileAdapter,
  createMatchedLocalAdapter,
  createMediaServerAdapter,
  createOfficialStreamingAdapter,
  createYoutubeAdapter,
  type LocalFileAdapterOptions,
} from "./adapters";
import { createAnilistProvider } from "./anilist";
import { createLocalProvider } from "./local";
import { createMediaServerProvider } from "./mediaserver";
import { createTmdbProvider } from "./tmdb";
import { createYoutubeProvider } from "./youtube";

export * from "./adapters";
export * from "./anilist";
export * from "./aniskip";
export * from "./auto-import";
export * from "./filename";
export * from "./local";
export * from "./local-library";
export * from "./matcher";
export * from "./mediaserver";
export * from "./scanner";
export * from "./shared";
export * from "./tmdb";
export * from "./youtube";

export interface RegistryOptions {
  driver: StorageDriver;
  localStream: LocalFileAdapterOptions;
  /**
   * What this host can do. Defaults to a full host (Atlas / Nova).
   * A thin host such as Pulse gets filesystem providers filtered out entirely.
   */
  host?: HostCapabilities;
  /** Provider ids the user has switched off in settings. */
  disabled?: readonly string[];
}

export interface Registries {
  providers: ProviderRegistry;
  adapters: SourceAdapterRegistry;
}

/**
 * Build the first-party registries.
 *
 * Registration order sets the order of search result groups, so the most
 * broadly useful sources come first. Providers that are not configured stay
 * registered but report `isAvailable() === false`, which lets Settings list
 * them as "not configured" rather than hiding them entirely.
 */
export function createRegistries(options: RegistryOptions): Registries {
  const host = options.host ?? FULL_HOST;

  const providers = new ProviderRegistry(host)
    .register(createTmdbProvider())
    .register(createAnilistProvider())
    .register(createYoutubeProvider())
    .register(createMediaServerProvider())
    .register(createLocalProvider(options.driver));

  for (const id of options.disabled ?? []) {
    providers.setEnabled(id, false);
  }

  /** Resolve details through the registry, keeping the adapter provider-agnostic. */
  const resolveDetails = async (item: MediaItem): Promise<MediaDetails | null> => {
    const provider = providers.forRef(item);
    if (!provider?.capabilities.details || !provider.getDetails) return null;

    return provider.getDetails(item, {
      signal: AbortSignal.timeout(8_000),
      timeoutMs: 8_000,
    });
  };

  const adapters = new SourceAdapterRegistry(host)
    .register(createYoutubeAdapter())
    .register(createLocalFileAdapter(options.driver, options.localStream))
    // Registered before the media server so an owned local copy wins.
    .register(createMatchedLocalAdapter(options.driver, options.localStream))
    .register(createMediaServerAdapter())
    // Licensed services, ranked below anything Vestra can play directly.
    .register(createOfficialStreamingAdapter({ resolveDetails }))
    .register(createExternalAdapter());

  return { providers, adapters };
}
