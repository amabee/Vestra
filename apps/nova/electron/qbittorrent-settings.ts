import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { safeStorage, ipcMain } from "electron";
import { getServerEnv, setQbittorrentCredentials } from "@vestra/config";
import { qbittorrent } from "@vestra/api";
import { getSettings } from "@vestra/storage";
import { z } from "zod";
import { resolveDataDir, getDriver } from "./services";
const credentials = z
  .object({
    url: z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine((value) => {
        const u = new URL(value);
        return (
          ["http:", "https:"].includes(u.protocol) &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash
        );
      }),
    username: z.string().trim().min(1).max(128),
    password: z.string().max(4096),
  })
  .strict();
let saved = false,
  loadError = false,
  writing = false;
let environment: { url: string; username: string; password: string };
const file = () => join(resolveDataDir(), "qbittorrent-credentials.enc");
const encrypted = () =>
  safeStorage.isEncryptionAvailable() &&
  (process.platform !== "linux" ||
    safeStorage.getSelectedStorageBackend() !== "basic_text");
function apply(value: { url: string; username: string; password: string }) {
  setQbittorrentCredentials(value);
  qbittorrent.resetQbittorrentSession();
}
export async function loadQbittorrentSettings() {
  const env = getServerEnv();
  environment ??= {
    url: env.QBITTORRENT_URL ?? "",
    username: env.QBITTORRENT_USERNAME ?? "",
    password: env.QBITTORRENT_PASSWORD ?? "",
  };
  try {
    const bytes = await readFile(file());
    if (!encrypted()) throw Error("Encryption unavailable");
    apply(credentials.parse(JSON.parse(safeStorage.decryptString(bytes))));
    saved = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") loadError = true;
  }
}
export function qbittorrentSettingsStatus() {
  const env = getServerEnv();
  return {
    configured: Boolean(env.QBITTORRENT_URL && env.QBITTORRENT_USERNAME),
    saved,
    loadError,
    encryptionAvailable: encrypted(),
    url: env.QBITTORRENT_URL ?? "http://localhost:8080",
    username: env.QBITTORRENT_USERNAME ?? "",
    source: saved ? "settings" : env.QBITTORRENT_URL ? "environment" : "none",
  };
}
export async function saveQbittorrentSettings(raw: unknown) {
  if (writing)
    throw Error("A torrent connection update is already in progress.");
  const result = raw === null ? null : credentials.safeParse(raw);
  if (result && !result.success)
    throw Error(
      "Enter an http(s) Web UI URL, username and password. Put credentials in their own fields.",
    );
  writing = true;
  try {
    if (!result) {
      await rm(file(), { force: true });
      apply(environment);
      saved = false;
    } else {
      if (!encrypted())
        throw Error("Secure credential storage is unavailable.");
      const bytes = safeStorage.encryptString(JSON.stringify(result.data));
      await mkdir(resolveDataDir(), { recursive: true });
      const temporary = file() + "." + randomUUID() + ".tmp";
      try {
        await writeFile(temporary, bytes, { mode: 0o600 });
        await rename(temporary, file());
      } finally {
        await rm(temporary, { force: true });
      }
      apply(result.data);
      saved = true;
    }
    loadError = false;
    return qbittorrentSettingsStatus();
  } finally {
    writing = false;
  }
}
export function registerTorrentIpc() {
  ipcMain.handle("torrents:configuration", () => qbittorrentSettingsStatus());
  ipcMain.handle("torrents:save", (_event, value) =>
    saveQbittorrentSettings(value),
  );
  ipcMain.handle("torrents:test", () => qbittorrent.getQbittorrentStatus());
  const settings = async () => {
    const settings = await getSettings(getDriver());
    if (!settings.downloads.qbittorrentEnabled)
      throw Error("Enable the torrent connection in Settings first.");
    if (!settings.downloads.category.trim())
      throw Error("Set a download category in Settings first.");
    return settings.downloads;
  };
  ipcMain.handle("torrents:list", async () => {
    const value = await settings();
    return (
      await qbittorrent.listTorrents({ category: value.category })
    ).filter((row) => row.category === value.category);
  });
  ipcMain.handle("torrents:add", async (_event, raw) => {
    const urls = z
      .array(z.string().trim().min(1).max(8192))
      .min(1)
      .max(20)
      .parse(raw);
    const value = await settings();
    await qbittorrent.addTorrent({
      urls,
      category: value.category,
      paused: false,
    });
  });
  for (const action of ["pause", "resume"] as const)
    ipcMain.handle(`torrents:${action}`, async (_event, raw) => {
      const hash = z
        .string()
        .regex(/^[a-fA-F0-9]{40,64}$/)
        .parse(raw);
      const value = await settings();
      const own = await qbittorrent.listTorrents({ category: value.category });
      if (
        !own.some((row) => row.hash === hash && row.category === value.category)
      )
        throw Error("This transfer is outside Vestra's download category.");
      await (
        action === "pause"
          ? qbittorrent.pauseTorrents
          : qbittorrent.resumeTorrents
      )([hash]);
    });
}
