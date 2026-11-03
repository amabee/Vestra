import { dialog, ipcMain, safeStorage, shell } from "electron";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { getSettings } from "@vestra/storage";
import { AniListAccount } from "./anilist-account";
import { getDriver, resolveDataDir } from "./services";

let account: AniListAccount | null = null;
let initialization: Promise<unknown> | null = null;
const ensureReady = () => (initialization ??= getAniListAccount().load());
export function getAniListAccount() {
  return (account ??= new AniListAccount(resolveDataDir(), {
    available: () =>
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== "linux" ||
        safeStorage.getSelectedStorageBackend() !== "basic_text"),
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (data) => safeStorage.decryptString(data),
  }));
}
export function registerAniListAccountIpc() {
  const service = getAniListAccount();
  void ensureReady();
  ipcMain.handle("anilist-account:status", async () => {
    await ensureReady();
    return service.status();
  });
  ipcMain.handle("anilist-account:connect", async (_e, token) => {
    await ensureReady();
    return service.connect(token);
  });
  ipcMain.handle("anilist-account:disconnect", async () => {
    await ensureReady();
    return service.disconnect();
  });
  ipcMain.handle("anilist-account:backup", async () => {
    await ensureReady();
    return service.backup();
  });
  ipcMain.handle("anilist-account:authorize", async (_e, raw) => {
    const id = z
      .string()
      .trim()
      .regex(/^[1-9]\d{0,11}$/)
      .parse(raw);
    await shell.openExternal(
      `https://anilist.co/api/v2/oauth/authorize?client_id=${id}&response_type=token`,
    );
  });
  ipcMain.handle("anilist-account:export", async () => {
    await ensureReady();
    const json = await service.exportLatest();
    const selection = await dialog.showSaveDialog({
      title: "Export AniList list backup",
      defaultPath: "vestra-anilist-backup.json",
      filters: [{ name: "JSON backup", extensions: ["json"] }],
    });
    if (selection.canceled || !selection.filePath) return false;
    await writeFile(selection.filePath, json, {
      encoding: "utf8",
      mode: 0o600,
    });
    return true;
  });
}
export async function startAniListAccount() {
  const service = getAniListAccount();
  await ensureReady();
  const tick = async () => {
    try {
      await service.backupIfDue(
        (await getSettings(getDriver())).sources.anilistAutoBackup,
      );
    } catch {
      /* Status carries the sanitized error; do not repeat credentials in logs. */
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), 60000);
  timer.unref();
}
