import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { safeStorage } from "electron";
import { getServerEnv, setTmdbCredentials } from "@vestra/config";
import { z } from "zod";
import { resolveDataDir } from "./services";

const credentials = z
  .object({
    accessToken: z
      .string()
      .trim()
      .max(4096)
      .regex(/^[A-Za-z0-9._-]*$/),
    apiKey: z
      .string()
      .trim()
      .max(128)
      .regex(/^[A-Za-z0-9]*$/),
  })
  .strict()
  .refine(
    (v) => Boolean(v.accessToken || v.apiKey),
    "Enter a TMDb token or API key.",
  );
let saved = false;
let loadError = false;
let environment: { accessToken: string; apiKey: string };
const file = () => join(resolveDataDir(), "tmdb-credentials.enc");
const encryptionAvailable = () =>
  safeStorage.isEncryptionAvailable() &&
  (process.platform !== "linux" ||
    safeStorage.getSelectedStorageBackend() !== "basic_text");

export async function loadTmdbSettings() {
  const env = getServerEnv();
  environment ??= {
    accessToken: env.TMDB_ACCESS_TOKEN ?? "",
    apiKey: env.TMDB_API_KEY ?? "",
  };
  try {
    const encrypted = await readFile(file());
    if (!encryptionAvailable()) throw Error("Encryption unavailable");
    const value = credentials.parse(
      JSON.parse(safeStorage.decryptString(encrypted)),
    );
    setTmdbCredentials(value);
    saved = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") loadError = true;
  }
}

export function tmdbSettingsStatus() {
  const env = getServerEnv();
  return {
    configured: Boolean(env.TMDB_ACCESS_TOKEN || env.TMDB_API_KEY),
    saved,
    encryptionAvailable: encryptionAvailable(),
    loadError,
    source: saved
      ? "settings"
      : env.TMDB_ACCESS_TOKEN || env.TMDB_API_KEY
        ? "environment"
        : "none",
  };
}

let writing = false;
export async function saveTmdbSettings(raw: unknown) {
  if (writing) throw Error("A TMDb settings update is already in progress.");
  const value = raw === null ? null : credentials.safeParse(raw);
  if (value && !value.success)
    throw Error("Enter a valid TMDb token or API key without spaces.");
  writing = true;
  try {
    if (value === null) {
      await rm(file(), { force: true });
      setTmdbCredentials(environment);
      saved = false;
    } else {
      if (!encryptionAvailable())
        throw Error(
          "Secure credential storage is unavailable on this computer.",
        );
      const encrypted = safeStorage.encryptString(JSON.stringify(value.data));
      await mkdir(resolveDataDir(), { recursive: true });
      const temporary = file() + "." + randomUUID() + ".tmp";
      try {
        await writeFile(temporary, encrypted, { mode: 0o600 });
        await rename(temporary, file());
      } finally {
        await rm(temporary, { force: true });
      }
      setTmdbCredentials(value.data!);
      saved = true;
    }
    loadError = false;
    return tmdbSettingsStatus();
  } finally {
    writing = false;
  }
}
