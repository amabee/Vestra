import { matchSourceAnime } from "./stream-source-adapter";
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
import { registerDeferredVariants, streamVariants } from "./remote-playback";
import type { AnimeSourceEpisodes, AnimeSourceTitle } from "../shared/anime";

export class AnimeService {
  private titles = new Map<
    string,
    { source: StreamSourceProvider; anime: Anime }
  >();
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
    const rows = await source.search(
      query,
      { limit: 50 },
      { signal: AbortSignal.timeout(15000), timeoutMs: 15000 },
    );
    this.requireCurrent(source);
    return rows.slice(0, 50).map((anime) => {
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
  async episodes(handle: string): Promise<AnimeSourceEpisodes> {
    const entry = this.titles.get(handle);
    if (!entry)
      throw new Error("This result expired. Search for the anime again.");
    const { source, anime } = entry;
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
      locator: registerDeferredVariants(async () => {
        this.requireCurrent(source);
        const results = await source.getStreams(episode.id, {
          signal: AbortSignal.timeout(15000),
          timeoutMs: 15000,
        });
        this.requireCurrent(source);
        const variants = streamVariants(results);
        if (!variants.length)
          throw new Error(
            "The source returned no playable video for this episode.",
          );
        return variants;
      }),
    }));
    const item = mediaItemSchema.parse({
      source: source.id,
      kind: "anime",
      sourceId: anime.id,
      title: anime.title,
      images: {},
      rating: {},
      isSeries: true,
    });
    return { item, queue };
  }
}
