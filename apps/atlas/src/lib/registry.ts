import "server-only";

import { createRegistries, type Registries } from "@vestra/providers";

import { getHostCapabilities } from "./host";
import { getDriver } from "./storage";

/**
 * Composition root for the provider system.
 *
 * Built once per process and cached. `server-only` keeps it out of the client
 * bundle — the registry closes over provider credentials and the storage driver.
 */

let cached: Registries | null = null;

export function getRegistries(): Registries {
  cached ??= createRegistries({
    driver: getDriver(),
    host: getHostCapabilities(),
    localStream: {
      // Atlas serves local files through a range-capable route handler; the
      // browser cannot open file:// URLs. Nova will override this.
      buildStreamUrl: (fileId) => `/api/stream/local/${encodeURIComponent(fileId)}`,
    },
  });

  return cached;
}

export function getProviderRegistry() {
  return getRegistries().providers;
}

export function getAdapterRegistry() {
  return getRegistries().adapters;
}
