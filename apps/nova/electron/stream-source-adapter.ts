import type { StreamSourceProvider } from "@vestra/extension-host";
import type { SourceAdapter } from "@vestra/provider-sdk";
import type { MediaItem, PlaybackSource } from "@vestra/types";
import { registerDeferredVariants, streamVariants } from "./remote-playback";

const MAX_EXTENSION_EPISODES = 2000;

function normaliseTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** One episode identity is reused for both initial extraction and mirror recovery. */
export function registerSourceEpisode(
  source: StreamSourceProvider,
  episodeId: string,
  check: () => void,
): string {
  const resolve = async (excludeServers: string[] = []) => {
    check();
    const results = await source.getStreams(
      episodeId,
      {
        signal: AbortSignal.timeout(15000),
        timeoutMs: 15000,
      },
      excludeServers.length ? { excludeServers } : undefined,
    );
    check();
    const variants = streamVariants(
      results.filter((result) => !excludeServers.includes(result.server)),
    );
    if (!variants.length)
      throw Error("This episode has no untried playable mirror.");
    return variants;
  };
  return registerDeferredVariants(() => resolve(), check, resolve);
}

export async function matchSourceAnime(
  source: StreamSourceProvider,
  item: MediaItem,
  context: import("@vestra/provider-sdk").ProviderContext,
  check: () => void = () => {},
) {
  const itemTitles = [item.title, item.originalTitle]
    .filter(
      (title): title is string =>
        typeof title === "string" && title.trim().length > 0,
    )
    .map(normaliseTitle);

  if (itemTitles.length === 0) return null;

  let match;
  for (const query of [
    ...new Set(
      [item.title, item.originalTitle].filter(
        (value): value is string => !!value?.trim(),
      ),
    ),
  ]) {
    const candidates = await source.search(query, { limit: 10 }, context);
    check();
    const matches = [
      ...new Map(
        candidates
          .filter((candidate) =>
            itemTitles.includes(normaliseTitle(candidate.title)),
          )
          .map((candidate) => [candidate.id, candidate]),
      ).values(),
    ];
    if (matches.length > 1)
      throw new Error(
        "Multiple source editions match this anime. Choose a title in source search.",
      );
    match = matches[0];
    if (match) break;
  }

  return match ?? null;
}

export function createStreamSourceAdapter(
  source: StreamSourceProvider,
  isCurrent: () => boolean = () => true,
): SourceAdapter {
  const requireCurrent = () => {
    if (!isCurrent())
      throw new Error("Anime source changed or was disabled. Reload episodes.");
  };
  return {
    id: `ext-stream-${source.id.slice("ext-".length)}`,
    name: source.name,
    isAvailable: isCurrent,
    canHandle: (item) =>
      source.kinds.includes(item.kind) && item.source !== "local",

    async resolve(item, context): Promise<PlaybackSource[]> {
      requireCurrent();
      const match = await matchSourceAnime(
        source,
        item,
        context,
        requireCurrent,
      );
      if (!match) return [];

      const episodes = await source.getEpisodes(match.id, context);
      requireCurrent();
      const playable: PlaybackSource[] = [];

      for (const episode of episodes.slice(0, MAX_EXTENSION_EPISODES)) {
        const locator = registerSourceEpisode(
          source,
          episode.id,
          requireCurrent,
        );
        playable.push({
          kind: "stream",
          locator,
          mimeType: null,
          label: episode.title ?? `Episode ${episode.number}`,
          // In-app extension streams outrank official deep links, while
          // local files and owned media-server streams still win above them.
          priority: 80,
          ...(Number.isInteger(episode.number)
            ? { episode: episode.number }
            : {}),
        });
      }

      return playable;
    },
  };
}
