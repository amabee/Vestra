import {
  matchSourceAnime,
  registerSourceEpisode,
} from "./stream-source-adapter";
import { randomUUID, createHash } from "node:crypto";
import {
  mediaItemSchema,
  type MediaItem,
  type PlaybackSource,
} from "@vestra/types";
import type {
  Anime,
  StreamSourceRegistry,
  StreamSourceProvider,
} from "@vestra/extension-host";

import type { AnimeSourceEpisodes, AnimeSourceTitle } from "../shared/anime";
import { TtlCache } from "./ttl-cache";

/** Search results stay fresh for five minutes. */
const SEARCH_TTL_MS = 5 * 60 * 1000;

export class AnimeService {
  private titles = new Map<
    string,
    { source: StreamSourceProvider; anime: Anime }
  >();
  private searches = new WeakMap<StreamSourceProvider, TtlCache<Anime[]>>();
  constructor(private registry: StreamSourceRegistry) {}
  list() {
    return this.registry
      .supporting("anime")
      .map((source) => ({ id: source.id, name: source.name }));
  }
  private requireCurrent(source: StreamSourceProvider) {
    if (
      this.registry.get(source.id) !== source ||
      !this.registry.isEnabled(source.id)
    )
      throw new Error("Anime source changed or was disabled. Search again.");
  }
  async search(id: string, query: string): Promise<AnimeSourceTitle[]> {
    const source = this.registry
      .supporting("anime")
      .find((row) => row.id === id);
    if (!source) throw new Error("This anime source is unavailable.");
    let cache = this.searches.get(source);
    if (!cache) {
      cache = new TtlCache<Anime[]>(SEARCH_TTL_MS);
      this.searches.set(source, cache);
    }
    const rows = await cache.run(
      query.toLowerCase(),
      async () => {
        const results = await source.search(
          query,
          { limit: 50 },
          {
            signal: AbortSignal.timeout(15000),
            timeoutMs: 15000,
          },
        );
        this.requireCurrent(source);
        return results.slice(0, 50);
      },
      (rows) => rows.length > 0,
    );
    this.requireCurrent(source);
    // Cache data, never expiring renderer handles. Reissue valid handles on every search.
    return rows.map((anime) => {
      const handle = randomUUID();
      if (this.titles.size >= 100)
        this.titles.delete(this.titles.keys().next().value!);
      this.titles.set(handle, { source, anime });
      return { handle, title: anime.title };
    });
  }

  async resolve(
    id: string,
    item: MediaItem,
  ): Promise<AnimeSourceEpisodes | null> {
    const source = this.registry
      .supporting("anime")
      .find((row) => row.id === id);
    if (!source)
      throw new Error(
        "This extension is disabled or unavailable. Select another extension.",
      );
    const anime = await matchSourceAnime(
      source,
      item,
      { signal: AbortSignal.timeout(15000), timeoutMs: 15000 },
      () => this.requireCurrent(source),
    );
    if (!anime) return null;
    const handle = randomUUID();
    if (this.titles.size >= 100)
      this.titles.delete(this.titles.keys().next().value!);
    this.titles.set(handle, { source, anime });
    const result = await this.episodes(handle);
    return {
      ...result,
      providerTitle: anime.title,
      item: {
        ...item,
        images: { ...item.images, poster: anime.cover ?? item.images.poster },
      },
    };
  }
  title(handle: string): MediaItem {
    const entry = this.titles.get(handle);
    if (!entry) throw Error("This result expired. Search for the anime again.");
    this.requireCurrent(entry.source);
    return mediaItemSchema.parse({
      source: entry.source.id,
      sourceId: entry.anime.id,
      kind: "anime",
      title: entry.anime.title,
      images: { poster: entry.anime.cover ?? null },
      rating: {},
      isSeries: true,
    });
  }
  async episodes(handle: string): Promise<AnimeSourceEpisodes> {
    const entry = this.titles.get(handle);
    if (!entry)
      throw new Error("This result expired. Search for the anime again.");
    const { source, anime } = entry;
    return this.episodeQueue(source, anime);
  }
  /** Saved provider titles keep their real provider ID, rather than an expiring handle. */
  rememberedItem(ref: { source: string; sourceId: string }): MediaItem | null {
    const known = [...this.titles.values()].find(
      (row) => row.source.id === ref.source && row.anime.id === ref.sourceId,
    );
    return known
      ? mediaItemSchema.parse({
          source: ref.source,
          sourceId: ref.sourceId,
          kind: "anime",
          title: known.anime.title,
          images: { poster: known.anime.cover ?? null },
          rating: {},
          isSeries: true,
        })
      : null;
  }
  async open(item: MediaItem): Promise<AnimeSourceEpisodes> {
    const source = this.registry
      .supporting("anime")
      .find((row) => row.id === item.source);
    if (!source) throw Error("This anime source is disabled or unavailable.");
    const result = await this.episodeQueue(source, {
      id: item.sourceId,
      provider: source.id,
      title: item.title,
      cover: item.images.poster ?? undefined,
    });
    return {
      ...result,
      item: { ...item, images: { ...result.item.images, ...item.images } },
    };
  }
  private async episodeQueue(
    source: StreamSourceProvider,
    anime: Anime,
  ): Promise<AnimeSourceEpisodes> {
    this.requireCurrent(source);
    const episodes = await source.getEpisodes(anime.id, {
      signal: AbortSignal.timeout(15000),
      timeoutMs: 15000,
    });
    this.requireCurrent(source);
    const queue: PlaybackSource[] = episodes.slice(0, 2000).map((episode) => ({
      kind: "stream",
      progressId:
        "stream-" +
        createHash("sha256")
          .update(
            JSON.stringify([
              source.id,
              anime.id,
              episode.number,
              episode.url ?? "",
            ]),
          )
          .digest("hex"),
      mimeType: null,
      label: episode.title || `Episode ${episode.number}`,
      priority: 80,
      ...(Number.isInteger(episode.number) ? { episode: episode.number } : {}),
      locator: registerSourceEpisode(source, episode.id, () =>
        this.requireCurrent(source),
      ),
    }));
    const item = mediaItemSchema.parse({
      source: source.id,
      kind: "anime",
      sourceId: anime.id,
      title: anime.title,
      images: { poster: anime.cover ?? null },
      rating: {},
      isSeries: true,
    });
    return { item, queue };
  }
}
