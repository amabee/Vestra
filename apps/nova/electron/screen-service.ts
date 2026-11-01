import { mediaItemSchema, type MediaItem } from "@vestra/types";
import type {
  Anime,
  StreamSourceProvider,
  StreamSourceRegistry,
} from "@vestra/extension-host";
import { discoveryCategorySchema } from "@vestra/extension-host";
import { z } from "zod";
import type { ScreenKind, ScreenPage, ScreenPlayback } from "../shared/screen";
import { sourceEpisodeQueue } from "./stream-source-adapter";
import { TtlCache } from "./ttl-cache";

export const screenKindSchema = z.enum(["movie", "tv"]);
const requestSchema = z.object({
  kind: screenKindSchema,
  source: z.string().min(1).max(120),
  query: z.string().trim().max(500).default(""),
  category: discoveryCategorySchema.default("popular"),
  page: z.number().int().min(1).max(100).default(1),
});

/** Native source browsing. Catalogue metadata and source identities stay separate. */
export class ScreenService {
  private pages = new WeakMap<StreamSourceProvider, TtlCache<ScreenPage>>();
  private episodes = new WeakMap<
    StreamSourceProvider,
    TtlCache<Awaited<ReturnType<StreamSourceProvider["getEpisodes"]>>>
  >();
  private known = new WeakMap<StreamSourceProvider, Map<string, MediaItem>>();
  constructor(private registry: StreamSourceRegistry) {}

  list(raw: unknown) {
    const kind = screenKindSchema.parse(raw);
    return this.registry.supporting(kind).map((source) => ({
      id: source.id,
      name: source.name,
      categories: source.browseCategories ?? [],
    }));
  }
  private source(id: string, kind: ScreenKind) {
    const source = this.registry.supporting(kind).find((row) => row.id === id);
    if (!source)
      throw Error("This Movies/TV extension is disabled or unavailable.");
    return source;
  }
  private check(source: StreamSourceProvider) {
    if (
      this.registry.get(source.id) !== source ||
      !this.registry.isEnabled(source.id)
    )
      throw Error("The extension changed. Reload titles before playing.");
  }
  private items(source: StreamSourceProvider, kind: ScreenKind, rows: Anime[]) {
    const onlyKind = source.kinds.length === 1 && source.kinds[0] === kind;
    const seen = new Set<string>();
    return rows
      .filter(
        (row) =>
          (row.kind === kind || (!row.kind && onlyKind)) &&
          !seen.has(row.id) &&
          !!seen.add(row.id),
      )
      .map((row) =>
        mediaItemSchema.parse({
          source: source.id,
          sourceId: row.id,
          kind,
          title: row.title,
          year: row.year ?? null,
          images: { poster: row.cover ?? null },
          rating: {},
          isSeries: kind === "tv",
        }),
      );
  }
  async load(raw: unknown): Promise<ScreenPage> {
    const request = requestSchema.parse(raw);
    const source = this.source(request.source, request.kind);
    let cache = this.pages.get(source);
    if (!cache) {
      cache = new TtlCache(120000, 40);
      this.pages.set(source, cache);
    }
    const page = await cache.run(JSON.stringify(request), async () => {
      const context = { signal: AbortSignal.timeout(15000), timeoutMs: 15000 };
      if (request.query) {
        const rows = await source.search(
          request.query,
          { limit: 50, kind: request.kind },
          context,
        );
        return {
          items: this.items(source, request.kind, rows),
          hasMore: false,
        };
      }
      if (
        !source.browse ||
        !source.browseCategories?.includes(request.category)
      )
        return { items: [], hasMore: false };
      const page = await source.browse(
        request.category,
        { page: request.page, limit: 24, kind: request.kind },
        context,
      );
      return {
        items: this.items(source, request.kind, page.items),
        hasMore: page.hasMore,
      };
    });
    this.check(source);
    let known = this.known.get(source);
    if (!known) {
      known = new Map();
      this.known.set(source, known);
    }
    for (const item of page.items)
      known.set(`${item.kind}:${item.sourceId}`, item);
    while (known.size > 512) known.delete(known.keys().next().value!);
    return page;
  }
  remembered(ref: {
    source: string;
    sourceId: string;
    kind: string;
  }): MediaItem | null {
    const source = this.registry.get(ref.source);
    if (!source || !this.registry.isEnabled(source.id)) return null;
    return this.known.get(source)?.get(`${ref.kind}:${ref.sourceId}`) ?? null;
  }
  async open(raw: unknown): Promise<ScreenPlayback> {
    const item = mediaItemSchema.parse(raw);
    const kind = screenKindSchema.parse(item.kind);
    const source = this.source(item.source, kind);
    let cache = this.episodes.get(source);
    if (!cache) {
      cache = new TtlCache(30000, 40);
      this.episodes.set(source, cache);
    }
    const episodes = await cache.run(`${kind}:${item.sourceId}`, () =>
      source.getEpisodes(item.sourceId, {
        signal: AbortSignal.timeout(15000),
        timeoutMs: 15000,
      }),
    );
    this.check(source);
    return {
      item,
      queue: sourceEpisodeQueue(source, item, episodes, () =>
        this.check(source),
      ),
    };
  }
}
