import {
  assertMangaSourceMethods,
  mangaSearchResultsSchema,
  mangaChaptersSchema,
  mangaPagesSchema,
  mangaAssetSchema,
  type InstalledExtension,
} from "@vestra/extension-host";
import type { MangaService, ReadingProgressRepository } from "./manga-service";

/** Connect the native SDK to the existing library, details, artwork and reader services. */
export class MangaExtensionRegistry {
  private active = new Map<string, object>();
  constructor(
    private service: MangaService,
    private call: (
      id: string,
      method: string,
      args: unknown[],
    ) => Promise<unknown>,
    private image: (request: unknown) => Promise<unknown>,
    private progress: (id: string) => ReadingProgressRepository,
    private isLoaded: (id: string) => boolean,
  ) {}

  attach(record: InstalledExtension, methods: readonly string[]): void {
    this.detach(record.id);
    if (record.manifest.role !== "manga-source") return;
    assertMangaSourceMethods(record.manifest.role, methods);
    const id = `ext-${record.id}`;
    const token = {};
    const grant = structuredClone(record.grant);
    const current = () => {
      if (this.active.get(record.id) !== token || !this.isLoaded(record.id))
        throw new Error(
          "Manga extension changed or was disabled. Reopen the library.",
        );
    };
    const asset = (raw: unknown) => {
      current();
      const parsed = mangaAssetSchema.parse(raw);
      if (
        !grant.granted.includes("network") ||
        !grant.allowedHosts.includes(new URL(parsed.url).hostname.toLowerCase())
      )
        throw new Error(
          "This manga image host was not granted to the extension.",
        );
      return parsed;
    };
    this.active.set(record.id, token);
    this.service.register(
      id,
      record.name,
      async (method, args) => {
        current();
        const guestMethod =
          method === "search"
            ? "search"
            : method === "findChapters"
              ? "getChapters"
              : method === "findChapterPages"
                ? "getPages"
                : null;
        if (!guestMethod)
          throw new Error("Unsupported manga extension method.");
        const guestArgs =
          method === "search"
            ? [String((args[0] as { query: string }).query), { limit: 100 }]
            : args;
        const raw = await this.call(record.id, guestMethod, guestArgs);
        current();
        if (method === "search")
          return mangaSearchResultsSchema.parse(raw).map((row) => ({
            id: row.id,
            title: row.title,
            ...(row.cover
              ? { image: asset(row.cover).url, imageHeaders: row.cover.headers }
              : {}),
          }));
        if (method === "findChapters")
          return mangaChaptersSchema
            .parse(raw)
            .map(({ number, ...row }) => ({ ...row, chapter: number }));
        return mangaPagesSchema
          .parse(raw)
          .map((row) => ({ ...row, ...asset(row) }));
      },
      async (request) => {
        const parsed = asset(request);
        const result = await this.image({ ...parsed, method: "GET" });
        current();
        return result;
      },
      this.progress(id),
    );
  }

  detach(extensionId: string) {
    this.active.delete(extensionId);
    this.service.unregister(`ext-${extensionId}`);
  }
}
