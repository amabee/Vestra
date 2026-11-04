import { playbackDiagnostics } from "./playback-diagnostics";
import type { StreamSourceProvider } from "@vestra/extension-host";
import type { SourceAdapter } from "@vestra/provider-sdk";
import {
  mediaItemSchema,
  type MediaItem,
  type PlaybackSource,
} from "@vestra/types";
import { createHash } from "node:crypto";
import type { Episode } from "@vestra/extension-host";
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

/** A source's parenthesized release year is metadata, not part of the name. */
function titleIdentity(title: string, year?: number | null) {
  const suffix = /\s+\((\d{4})\)\s*$/.exec(title);
  const suffixYear = suffix ? Number(suffix[1]) : undefined;
  return {
    title: normaliseTitle(suffix ? title.slice(0, suffix.index) : title),
    year: year ?? suffixYear,
    conflictingYear: !!(year && suffixYear && year !== suffixYear),
  };
}

/** One episode identity is reused for both initial extraction and mirror recovery. */
export function registerSourceEpisode(
  source: StreamSourceProvider,
  episodeId: string,
  check: () => void,
  refreshOnFailure = false,
): string {
  const resolve = async (excludeServers: string[] = []) => {
    check();
    const started = Date.now();
    try {
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
      playbackDiagnostics.observe(source.id, started);
      return variants;
    } catch (error) {
      playbackDiagnostics.observe(source.id, started, error);
      playbackDiagnostics.failure("stream extraction", error, source.id);
      throw error;
    }
  };
  return registerDeferredVariants(
    () => resolve(),
    check,
    resolve,
    refreshOnFailure,
  );
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
    .map((title) => titleIdentity(title, item.year).title);

  if (itemTitles.length === 0) return null;

  let match;
  for (const query of [
    ...new Set(
      [item.title, item.originalTitle].filter(
        (value): value is string => !!value?.trim(),
      ),
    ),
  ]) {
    const candidates = await source.search(
      query,
      { limit: 10, kind: item.kind },
      context,
    );
    check();
    const matches = [
      ...new Map(
        candidates
          .filter((candidate) => {
            const identity = titleIdentity(candidate.title, candidate.year);
            const target = titleIdentity(item.title, item.year);
            return (
              !identity.conflictingYear &&
              !target.conflictingYear &&
              itemTitles.includes(identity.title) &&
              (!candidate.kind || candidate.kind === item.kind) &&
              (!identity.year || !target.year || identity.year === target.year)
            );
          })
          .map((candidate) => [candidate.id, candidate]),
      ).values(),
    ];
    if (matches.length > 1)
      throw new Error(
        "Multiple source editions match this title. Choose a title in source search.",
      );
    match = matches[0];
    if (match) break;
  }

  return match ?? null;
}

/** One stable identity across search, saved-title reopening and catalogue matching. */
export function sourceEpisodeQueue(
  source: StreamSourceProvider,
  item: MediaItem,
  episodes: Episode[],
  check: () => void,
): PlaybackSource[] {
  const seen = new Set<string>();
  return episodes
    .filter((episode) => episode.animeId === item.sourceId)
    .filter((episode) => {
      if (seen.has(episode.id)) return false;
      seen.add(episode.id);
      return true;
    })
    .sort((a, b) => (a.season ?? 1) - (b.season ?? 1) || a.number - b.number)
    .slice(0, MAX_EXTENSION_EPISODES)
    .map((episode) => ({
      kind: "stream",
      locator: registerSourceEpisode(
        source,
        episode.id,
        check,
        item.kind === "movie" || item.kind === "tv",
      ),
      progressId:
        "stream-" +
        createHash("sha256")
          .update(
            JSON.stringify([
              source.id,
              item.kind,
              item.sourceId,
              episode.id,
              episode.season ?? null,
            ]),
          )
          .digest("hex"),
      mimeType: null,
      label:
        item.kind === "movie"
          ? episode.title || item.title
          : `${episode.season === undefined ? "" : `S${episode.season} · `}E${episode.number}${episode.title ? ` · ${episode.title}` : ""}`,
      priority: 80,
      ...(item.kind !== "movie" && Number.isFinite(episode.number)
        ? { episode: episode.number }
        : {}),
      ...(item.kind !== "movie" && episode.season !== undefined
        ? { season: episode.season }
        : {}),
    }));
}

export function createStreamSourceAdapter(
  source: StreamSourceProvider,
  isCurrent: () => boolean = () => true,
): SourceAdapter {
  const requireCurrent = () => {
    if (!isCurrent())
      throw new Error(
        "Streaming source changed or was disabled. Reload episodes.",
      );
  };
  return {
    id: `ext-stream-${source.id.startsWith("ext-") ? source.id.slice("ext-".length) : source.id}`,
    name: source.name,
    isAvailable: isCurrent,
    canHandle: (item) =>
      source.kinds.includes(item.kind) && item.source !== "local",

    async resolve(item, context): Promise<PlaybackSource[]> {
      requireCurrent();
      const match =
        (item.kind === "movie" || item.kind === "tv") &&
        item.source === source.id
          ? { id: item.sourceId }
          : await matchSourceAnime(source, item, context, requireCurrent);
      if (!match) return [];

      const episodes = await source.getEpisodes(match.id, context);
      requireCurrent();
      if (item.kind === "movie" || item.kind === "tv")
        return sourceEpisodeQueue(
          source,
          mediaItemSchema.parse({
            ...item,
            source: source.id,
            sourceId: match.id,
          }),
          episodes,
          requireCurrent,
        );
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
