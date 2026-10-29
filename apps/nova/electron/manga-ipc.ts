import { ipcMain } from "electron";
import { z } from "zod";
import { getDriver, resolveDataDir } from "./services";
import { join } from "node:path";
import { MangaCoverCache } from "./manga-cover-cache";
import { MangaDiscovery } from "./manga-discovery";
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
): void {
  const api = getMangaService();
  api.registerCatalogueImages(image);
  const discovery = new MangaDiscovery(getDriver(), (id, url) =>
    api.catalogueCover(id, url),
  );
  ipcMain.handle("manga:discover", async (_e, filters) => {
    const page = await discovery.browse(filters);
    api.preloadArtwork(
      page.items
        .map((item) => item.cover)
        .filter((value): value is string => !!value),
    );
    return page;
  });
  ipcMain.handle("manga:sources", () => api.list());
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
