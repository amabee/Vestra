import { ipcMain } from "electron";
import { z } from "zod";
import { getDriver } from "./services";
import { MangaService } from "./manga-service";
let service: MangaService | null = null;
export function getMangaService(): MangaService {
  return (service ??= new MangaService(getDriver()));
}
const text = z.string().min(1).max(4096);
export function registerMangaIpc(): void {
  const api = getMangaService();
  ipcMain.handle("manga:sources", () => api.list());
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
