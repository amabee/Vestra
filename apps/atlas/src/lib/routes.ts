import type { MediaItem, MediaRef } from "@vestra/types";

/** Canonical route for a media details page. */
export function mediaHref(ref: MediaRef | MediaItem): string {
  return `/media/${ref.source}/${ref.kind}/${encodeURIComponent(ref.sourceId)}`;
}

export function searchHref(query: string): string {
  return `/search?q=${encodeURIComponent(query)}`;
}
