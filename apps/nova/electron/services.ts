import { join } from "node:path";

import { createRegistries, type Registries } from "@vestra/providers";
import { NodeDriver, type StorageDriver } from "@vestra/storage";
import { app } from "electron";

/**
 * Composition root.
 *
 * The deleted Next.js app assembled this per server process; Nova assembles it
 * once in the main process. Nothing here is reachable from the renderer except
 * through the IPC handlers, which is the point — the registry closes over
 * provider credentials and the storage driver.
 */

let driver: StorageDriver | null = null;
let registries: Registries | null = null;

/**
 * Where Vestra persists watchlist, progress, settings and the library index.
 *
 * The OS app-data directory rather than the working directory, so a packaged
 * Nova writes somewhere durable and writable.
 */
export function resolveDataDir(): string {
  return join(app.getPath("userData"), "data");
}

export function getDriver(): StorageDriver {
  driver ??= new NodeDriver(resolveDataDir());
  return driver;
}

/**
 * Provider and adapter registries.
 *
 * Built lazily and cached. Nova is a full host: it has a real filesystem and
 * may load extensions, so nothing is filtered out by host capability.
 */
export function getRegistries(): Registries {
  registries ??= createRegistries({
    driver: getDriver(),
    host: { platform: "desktop", filesystem: true, extensions: true },
    localStream: {
      // Local files are served through Nova's own protocol handler rather than
      // an HTTP route. A renderer cannot open `file://` under sandbox, and
      // there is no longer a server to range-stream through.
      buildStreamUrl: (fileId) => `vestra-media://local/${encodeURIComponent(fileId)}`,
    },
  });

  return registries;
}

export function getProviderRegistry() {
  return getRegistries().providers;
}

export function getAdapterRegistry() {
  return getRegistries().adapters;
}
