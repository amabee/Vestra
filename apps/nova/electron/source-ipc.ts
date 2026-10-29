import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { dialog, ipcMain } from "electron";
import { z } from "zod";
import { SourceManager, sourceId, sourceOptions } from "./source-manager";
import {
  activateCSharpSource,
  deactivateCSharpSource,
  checkCSharpSource,
  readLegacyCSharpSources,
} from "./csharp-providers";
import { getDriver } from "./services";

export function registerSourceIpc(): void {
  const manager = new SourceManager(getDriver(), {
    activate: activateCSharpSource,
    deactivate: deactivateCSharpSource,
    check: checkCSharpSource,
  });
  const ready = manager.initialize(readLegacyCSharpSources);
  void ready.catch((error) =>
    console.error("[nova] source initialization failed", error),
  );
  const pending = new Map<
    string,
    { source: string; filename: string; expires: number }
  >();
  ipcMain.handle("sources:list", async () => {
    await ready;
    return manager.list();
  });
  ipcMain.handle("sources:pick", async () => {
    await ready;
    const selection = await dialog.showOpenDialog({
      title: "Import provider script",
      properties: ["openFile"],
      filters: [{ name: "Provider scripts", extensions: ["js", "ts"] }],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    const path = selection.filePaths[0];
    if (!/\.(?:js|ts)$/i.test(path))
      throw new Error("Choose a JavaScript or TypeScript provider script.");
    if ((await stat(path)).size > 1048576)
      throw new Error("Source exceeds 1 MiB.");
    const source = await readFile(path, "utf8");
    const bytes = Buffer.byteLength(source);
    if (!bytes || bytes > 1048576)
      throw new Error("Source must be nonempty and at most 1 MiB.");
    for (const [token, entry] of pending)
      if (entry.expires < Date.now()) pending.delete(token);
    if (pending.size >= 4) pending.delete(pending.keys().next().value!);
    const token = randomUUID();
    const filename = basename(path);
    pending.set(token, { source, filename, expires: Date.now() + 600000 });
    return {
      token,
      filename,
      bytes,
      sha256: createHash("sha256").update(source).digest("hex"),
    };
  });
  ipcMain.handle("sources:install", async (_e, token, options) => {
    await ready;
    const key = z.string().uuid().parse(token);
    const script = pending.get(key);
    if (!script || script.expires < Date.now())
      throw new Error("Import expired. Choose the script again.");
    await manager.install({
      ...sourceOptions.parse(options),
      source: script.source,
      filename: script.filename,
      enabled: true,
    });
    pending.delete(key);
  });
  ipcMain.handle("sources:update", async (_e, id, options) => {
    await ready;
    await manager.update(sourceId.parse(id), options);
  });
  ipcMain.handle("sources:replace", async (_e, id, token, expectedHash) => {
    await ready;
    const key = z.string().uuid().parse(token);
    const script = pending.get(key);
    if (!script || script.expires < Date.now())
      throw new Error("Import expired. Choose the script again.");
    await manager.replace(
      sourceId.parse(id),
      { source: script.source, filename: script.filename },
      z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(expectedHash),
    );
    pending.delete(key);
  });
  ipcMain.handle("sources:remove", async (_e, id) => {
    await ready;
    await manager.remove(sourceId.parse(id));
  });
  ipcMain.handle("sources:check", async (_e, id) => {
    await ready;
    await manager.check(sourceId.parse(id));
  });
}
