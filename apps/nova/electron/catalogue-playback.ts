import {
  resolvePlayback,
  type ProviderRegistry,
  type SourceAdapterRegistry,
} from "@vestra/provider-sdk";
import type { StreamSourceRegistry } from "@vestra/extension-host";
import type { MediaItem, MediaRef } from "@vestra/types";

/** Resolve catalogue metadata before asking adapters to match provider titles. */
export async function resolveCataloguePlayback(
  providers: ProviderRegistry,
  adapters: SourceAdapterRegistry,
  streams: StreamSourceRegistry,
  ref: MediaRef,
  selectedSource?: string,
) {
  const signal = AbortSignal.timeout(15000);
  const context = { signal, timeoutMs: 15000 };
  const provider = providers.forRef(ref);
  let item: MediaItem | null = null;
  try {
    item = (await provider?.getDetails?.(ref, context)) ?? null;
  } catch (error) {
    // Local-file adapters can still resolve an offline catalogue reference.
    if (selectedSource) throw error;
  }
  let adapterIds: string[] | undefined;
  let selectedAdapter: string | undefined;
  if (ref.kind === "anime" && selectedSource) {
    const source = streams
      .supporting("anime")
      .find((row) => row.id === selectedSource);
    if (!source)
      throw new Error(
        "The selected anime source is unavailable. Choose an enabled source in Anime.",
      );
    if (!item)
      throw new Error(
        "Anime information could not be loaded. Retry to find episodes.",
      );
    selectedAdapter = `ext-stream-${source.id.slice("ext-".length)}`;
    // Keep owned files and official links; only the selected community source
    // may search for a matching title.
    adapterIds = adapters
      .all()
      .filter(
        (adapter) =>
          !adapter.id.startsWith("ext-stream-") ||
          adapter.id === selectedAdapter,
      )
      .map((adapter) => adapter.id);
  }
  let sourceError: unknown;
  const queue = await resolvePlayback(adapters, item ?? (ref as MediaItem), {
    ...context,
    ...(adapterIds ? { adapterIds } : {}),
    onAdapterError: (id, error) => {
      if (id === selectedAdapter) sourceError = error;
    },
  });
  if (
    sourceError &&
    !queue.some((row) => row.kind === "file" || row.kind === "stream")
  )
    throw sourceError;
  return queue;
}
