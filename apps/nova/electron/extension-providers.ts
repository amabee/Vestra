import {
  canActAsProvider,
  createExtensionProvider,
  type InstalledExtension,
} from "@vestra/extension-host";

import { callExtension } from "./extensions";
import { getProviderRegistry } from "./services";

/**
 * Joining an installed extension to the rest of the app.
 *
 * The sandbox and the provider registry were each finished long before this
 * existed, and nothing connected them: an extension could be installed, run,
 * and answer calls, but nothing ever called it, so installing one changed
 * nothing a user could see.
 *
 * Kept out of `extensions.ts` on purpose. That module owns the worker and the
 * grants and has no business knowing what a provider is; this is the seam.
 */

/**
 * Offer an extension as a search provider.
 *
 * Silently does nothing when the extension is not one — plenty of useful
 * extensions never search — so callers can attach unconditionally after a
 * load.
 */
export function attachExtensionProvider(record: InstalledExtension, methods: string[]): void {
  const kinds = record.manifest.kinds;

  // Both are required, and for different reasons: without `search` there is
  // nothing to ask, and without `kinds` there is nowhere to file the answer.
  // Registering either way would put a permanently empty source in Settings,
  // or file results under a kind the extension never claimed.
  if (!canActAsProvider(methods) || kinds.length === 0) return;

  const provider = createExtensionProvider({
    extensionId: record.id,
    // From the manifest the user consented to, not from the guest.
    name: record.name,
    kinds,
    methods,
    call: (method, args) => callExtension(record.id, method, [...args]),
    onWarning: (message) => console.warn(`[extension:${record.id}] ${message}`),
  });

  const registry = getProviderRegistry();

  // A reinstall re-registers the same id; the registry refuses duplicates.
  registry.unregister(provider.id);
  registry.register(provider);
}

/** Remove an extension's provider. Safe to call for one that never had one. */
export function detachExtensionProvider(extensionId: string): void {
  getProviderRegistry().unregister(`ext-${extensionId}`);
}
