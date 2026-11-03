import { handleIpc } from "./ipc-security";
import { app, BrowserWindow, dialog, safeStorage, shell } from "electron";
import { writeFile } from "node:fs/promises";
import { getSettings } from "@vestra/storage";
import { AniListAccount } from "./anilist-account";
import { getDriver, resolveDataDir } from "./services";
import { AniListBrowserLogin, isAniListCallback } from "./anilist-login";

let account: AniListAccount | null = null;
let initialization: Promise<unknown> | null = null;
let login: AniListBrowserLogin | null = null;
const ensureReady = () => (initialization ??= getAniListAccount().load());
function getLogin() {
  return (login ??= new AniListBrowserLogin({
    clientId: process.env.ANILIST_CLIENT_ID?.trim() || undefined,
    openBrowser: (url) => shell.openExternal(url),
    connect: (token) => getAniListAccount().connect(token),
    cancelConnect: () => getAniListAccount().disconnect(),
    changed: broadcast,
  }));
}
function snapshot() {
  return { ...getAniListAccount().status(), login: getLogin().snapshot() };
}
function broadcast() {
  const value = snapshot();
  for (const window of BrowserWindow.getAllWindows())
    if (!window.isDestroyed())
      window.webContents.send("anilist-account:changed", value);
}
export async function handleAniListCallback(raw: string) {
  if (!isAniListCallback(raw)) return false;
  await app.whenReady();
  await ensureReady();
  const handled = await getLogin().complete(raw);
  broadcast();
  return handled;
}
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
  handleIpc("anilist-account:status", async () => {
    await ensureReady();
    return snapshot();
  });
  handleIpc("anilist-account:connect", async (_e, token) => {
    await ensureReady();
    await getLogin().cancel();
    await service.connect(token);
    broadcast();
    return snapshot();
  });
  handleIpc("anilist-account:disconnect", async () => {
    await ensureReady();
    await getLogin().cancel();
    await service.disconnect();
    broadcast();
    return snapshot();
  });
  handleIpc("anilist-account:backup", async () => {
    await ensureReady();
    return service.backup();
  });
  handleIpc("anilist-account:sign-in", async () => {
    await ensureReady();
    if (!service.status().encryptionAvailable)
      throw new Error("Secure storage is unavailable on this computer.");
    const registered = process.defaultApp
      ? app.setAsDefaultProtocolClient("vestra", process.execPath, [
          app.getAppPath(),
        ])
      : app.setAsDefaultProtocolClient("vestra");
    if (!registered)
      throw new Error(
        "Vestra could not enable browser sign-in. Reinstall the app and try again.",
      );
    await getLogin().begin();
    return snapshot();
  });
  handleIpc("anilist-account:cancel-sign-in", async () => {
    await ensureReady();
    await getLogin().cancel();
    return snapshot();
  });
  handleIpc("anilist-account:export", async () => {
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
