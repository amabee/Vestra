import { ipcMain } from "electron";
import { z } from "zod";
import { getDriver, resolveDataDir } from "./services";
import { join } from "node:path";
import { MangaCoverCache } from "./manga-cover-cache";
import { MangaDiscovery } from "./manga-discovery";
import { MangaTitleResolver } from "./manga-title-resolver";
import { MangaDetails } from "./manga-details";
import type { MangaBookmarkRepository } from "./manga-bookmarks";
import { MangaService } from "./manga-service";
let service: MangaService | null = null;
export function getMangaService(): MangaService {
  return (service ??= new MangaService(
    getDriver(),
    new MangaCoverCache(join(resolveDataDir(), "manga-covers")),
  ));
}
const text = z.string().min(1).max(4096);
export function registerMangaIpc(
  image: (request: unknown) => Promise<unknown>,
  bookmarks: MangaBookmarkRepository,
): void {
  const api = getMangaService();
  api.registerCatalogueImages(image);
  api.registerBookmarks(bookmarks);
  const details = new MangaDetails(getDriver(), (id, url) =>
    api.catalogueCover(id, url),
  );
  const resolver = new MangaTitleResolver(getDriver(), api, (id) =>
    details.get(id),
  );
  ipcMain.handle("manga:resolve", (_e, p, selection) => {
    const provider = z.string().min(1).max(120).parse(p);
    const input = z
      .discriminatedUnion("kind", [
        z.object({
          kind: z.literal("catalogue"),
          id: z.number().int().positive(),
        }),
        z.object({
          kind: z.literal("source"),
          source: z.string().min(1).max(120),
          id: text,
          title: z.string().max(500).optional(),
        }),
      ])
      .parse(selection);
    return input.kind === "catalogue"
      ? resolver.catalogue(provider, input.id)
      : resolver.source(provider, input.source, input.id, input.title);
  });
  const discovery = new MangaDiscovery(getDriver(), (id, url) =>
    api.catalogueCover(id, url),
  );
  ipcMain.handle("manga:discover", async (_e, filters) => {
    const page = await discovery.browse(filters);
    page.items.forEach((item) => api.registerCatalogueTitle(item));
    api.preloadArtwork(
      page.items
        .map((item) => item.cover)
        .filter((value): value is string => !!value),
    );
    return page;
  });
  ipcMain.handle("manga:sources", () => api.list());
  ipcMain.handle("manga:bookmarks", () => api.bookmarks());
  ipcMain.handle("manga:bookmark", (_e, kind, source, id, saved) =>
    api.bookmark(
      z.enum(["source", "catalogue"]).parse(kind),
      z.string().min(1).max(120).parse(source),
      text.parse(id),
      z.boolean().parse(saved),
    ),
  );
  ipcMain.handle("manga:book", (_e, p, id, title) =>
    api.resolveBook(
      text.parse(p),
      text.parse(id),
      z.string().trim().max(500).optional().parse(title),
    ),
  );
  ipcMain.handle("manga:info", async (_e, p, id) => {
    const book = api.knownBook(text.parse(p), text.parse(id));
    const info = await details.source(book.title);
    if (info) api.registerCatalogueTitle(info);
    return info;
  });
  ipcMain.handle("manga:details", async (_e, id) => {
    const info = await details.get(z.number().int().positive().parse(id));
    if (info) api.registerCatalogueTitle(info);
    return info;
  });
  ipcMain.handle("manga:catalogue-cover", (_e, id) =>
    api.refreshCatalogueCover(z.number().int().positive().parse(id)),
  );
  ipcMain.handle("manga:recent", (_e, p) => api.recent(text.parse(p)));
  ipcMain.handle("manga:search", (_e, p, q) =>
    api.search(text.parse(p), z.string().trim().min(1).max(500).parse(q)),
  );
  ipcMain.handle("manga:chapters", (_e, p, b) =>
    api.chapters(text.parse(p), text.parse(b)),
  );
  ipcMain.handle("manga:pages", (_e, p, b, c) =>
    api.pages(text.parse(p), text.parse(b), text.parse(c)),
  );
  ipcMain.handle("manga:image", (_e, h) =>
    api.image(z.string().uuid().parse(h)),
  );
  ipcMain.handle("manga:cover", (_e, p, b, refresh) =>
    api.cover(text.parse(p), text.parse(b), z.boolean().parse(refresh)),
  );
  ipcMain.handle("manga:progress", (_e, p, b) =>
    api.progress(text.parse(p), text.parse(b)),
  );
  ipcMain.handle("manga:save", (_e, p, b, c, n) =>
    api.save(
      text.parse(p),
      text.parse(b),
      text.parse(c),
      z.number().int().nonnegative().parse(n),
    ),
  );
}
