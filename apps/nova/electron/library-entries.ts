import { localFileToMediaItem } from "@vestra/providers";
import { getLocalFiles } from "@vestra/storage";
import { mediaKey, type LocalMediaFile, type MediaItem } from "@vestra/types";

import { getDriver, getProviderRegistry } from "./services";

/**
 * The local library, expressed as works rather than files.
 *
 * A scanned file records a `matchedRef` and nothing else — no title, no
 * artwork. Rendering that directly is why the Library screen was a wall of
 * paths. This resolves each distinct ref through its provider once, then hangs
 * the files off it.
 */

export interface LibraryEntry {
  /** Resolved metadata where a match exists, otherwise built from the filename. */
  item: MediaItem;
  matched: boolean;
  files: LocalMediaFile[];
  totalBytes: number;
}

/**
 * Metadata cache, keyed by media key.
 *
 * Lives for the process. Provider metadata is stable enough that refetching on
 * every visit would be a lot of network for no visible difference.
 */
const metadataCache = new Map<string, MediaItem | null>();

/** Provider lookups run in small batches — a large library would otherwise open hundreds of sockets at once. */
const CONCURRENCY = 5;

async function resolveItem(ref: MediaItem): Promise<MediaItem | null> {
  const key = mediaKey(ref);

  const cached = metadataCache.get(key);
  if (cached !== undefined) return cached;

  const provider = getProviderRegistry().forRef(ref);
  if (!provider?.capabilities.details || !provider.getDetails) {
    metadataCache.set(key, null);
    return null;
  }

  try {
    const details = await provider.getDetails(ref, {
      signal: AbortSignal.timeout(10_000),
      timeoutMs: 10_000,
    });
    metadataCache.set(key, details);
    return details;
  } catch {
    // A provider being down should cost the entry its artwork, not its row.
    metadataCache.set(key, null);
    return null;
  }
}

export async function buildLibraryEntries(): Promise<LibraryEntry[]> {
  const files = await getLocalFiles(getDriver());

  // Group first. Everything below operates on distinct works, not files.
  const groups = new Map<string, { ref: MediaItem | null; files: LocalMediaFile[] }>();

  for (const file of files) {
    const key = file.matchedRef
      ? mediaKey(file.matchedRef)
      : `unmatched:${file.parsedTitle ?? file.fileName}`;

    const existing = groups.get(key);
    if (existing) {
      existing.files.push(file);
      continue;
    }

    groups.set(key, {
      ref: file.matchedRef ? (file.matchedRef as MediaItem) : null,
      files: [file],
    });
  }

  const pending = [...groups.values()];
  const entries: LibraryEntry[] = [];

  for (let index = 0; index < pending.length; index += CONCURRENCY) {
    const batch = pending.slice(index, index + CONCURRENCY);

    const resolved = await Promise.all(
      batch.map(async (group) => {
        const first = group.files[0];
        if (!first) return null;

        const item = group.ref ? await resolveItem(group.ref) : null;

        return {
          // Falling back to the filename keeps unmatched files visible and
          // labelled rather than dropping them from the screen.
          item: item ?? localFileToMediaItem(first),
          matched: item !== null,
          files: group.files,
          totalBytes: group.files.reduce((sum, file) => sum + file.sizeBytes, 0),
        } satisfies LibraryEntry;
      }),
    );

    for (const entry of resolved) {
      if (entry) entries.push(entry);
    }
  }

  // Matched first, then alphabetical — the ones with artwork lead the grid.
  return entries.sort((a, b) => {
    if (a.matched !== b.matched) return a.matched ? -1 : 1;
    return a.item.title.localeCompare(b.item.title);
  });
}
