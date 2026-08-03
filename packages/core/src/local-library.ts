import type { LocalMediaFile, MediaItem } from "@vestra/types";

/** Present a scanned file as a normalised MediaItem so shared UI can render it. */
export function localFileToMediaItem(file: LocalMediaFile): MediaItem {
  const hasEpisode = file.parsedSeason !== null && file.parsedEpisode !== null;

  const title = file.parsedTitle ?? file.fileName;
  const episodeSuffix = hasEpisode
    ? ` · S${String(file.parsedSeason).padStart(2, "0")}E${String(file.parsedEpisode).padStart(2, "0")}`
    : "";

  return {
    source: "local",
    kind: "local-video",
    sourceId: file.id,
    title: `${title}${episodeSuffix}`,
    originalTitle: file.fileName,
    year: file.parsedYear,
    overview: null,
    images: {
      poster: file.thumbnailPath,
      backdrop: file.thumbnailPath,
      thumbnail: file.thumbnailPath,
      placeholder: null,
    },
    rating: { score: null, votes: null },
    genres: [],
    status: "released",
    durationSeconds: file.durationSeconds,
    isSeries: hasEpisode,
    sourceUrl: null,
  };
}

/** Newest additions first — powers the "Recently Added Local Media" row. */
export function recentlyAddedLocal(files: readonly LocalMediaFile[], limit = 20): MediaItem[] {
  return [...files]
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, limit)
    .map(localFileToMediaItem);
}
