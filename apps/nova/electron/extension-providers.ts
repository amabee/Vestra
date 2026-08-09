import {
  canActAsProvider,
  canActAsStreamSource,
  createExtensionProvider,
  createStreamSourceProvider,
  type InstalledExtension,
} from "@vestra/extension-host";

import { callExtension } from "./extensions";
import { getProviderRegistry, getStreamSourceRegistry } from "./services";

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

  // A stream source is not a catalogue. It may well export `search` and
  // declare kinds, which is exactly why role is checked rather than inferred:
  // registering one here would fill the catalogue with titles that have no
  // metadata and no detail page.
  if (record.manifest.role !== "metadata") return;

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

/**
 * Offer an extension as a stream source.
 *
 * The same seam as `attachExtensionProvider`, against a different registry,
 * for a capability the catalogue must not see. Kept as its own function rather
 * than a branch inside that one: the two share a shape but nothing else, and
 * a single function would invite the two registries being confused later.
 *
 * Silently does nothing when the extension is not a stream source, so callers
 * can attach unconditionally after a load.
 */
export function attachStreamSourceProvider(
  record: InstalledExtension,
  methods: string[],
): void {
  if (record.manifest.role !== "stream-source") return;

  const kinds = record.manifest.kinds;

  // All three methods, plus a kind to file the source under. Unlike metadata,
  // a partial stream source is worse than none: it fails after the user has
  // chosen an episode rather than before.
  if (!canActAsStreamSource(methods) || kinds.length === 0) return;

  const source = createStreamSourceProvider({
    extensionId: record.id,
    // From the manifest the user consented to, not from the guest.
    name: record.name,
    kinds,
    methods,
    call: (method, args) => callExtension(record.id, method, [...args]),
    onWarning: (message) => console.warn(`[stream-source:${record.id}] ${message}`),
  });

  const registry = getStreamSourceRegistry();

  // A reinstall re-registers the same id; the registry refuses duplicates.
  registry.unregister(source.id);
  registry.register(source);
}

/** Remove an extension's stream source. Safe to call for one that never had one. */
export function detachStreamSourceProvider(extensionId: string): void {
  getStreamSourceRegistry().unregister(`ext-${extensionId}`);
}
