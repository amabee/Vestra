import "server-only";

import type { MediaDetails, MediaKind, MediaSource } from "@vestra/types";

import { getProviderRegistry } from "./registry";

/**
 * Resolve full details for any `source`/`kind`/`id` triple.
 *
 * Dispatch now goes through the registry, so a newly registered provider
 * becomes reachable here without touching this file. Returns null when the
 * provider is unknown, unavailable, or has no details capability.
 */
export async function getMediaDetails(
  source: MediaSource,
  kind: MediaKind,
  id: string,
): Promise<MediaDetails | null> {
  const ref = { source, kind, sourceId: id };
  const provider = getProviderRegistry().forRef(ref);

  if (!provider?.capabilities.details || !provider.getDetails) return null;

  return provider.getDetails(ref, {
    signal: AbortSignal.timeout(8_000),
    timeoutMs: 8_000,
  });
}
