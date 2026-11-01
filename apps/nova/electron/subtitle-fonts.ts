import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { app } from "electron";

import { safeFetch, safeFetchBytes } from "./safe-fetch";

/**
 * Google Fonts for subtitles.
 *
 * The family list comes from Google's public metadata (no key needed). A
 * font is installed by asking Google's CSS service for its file, then
 * downloading that file through the same address-checked fetch the rest of
 * the app uses. Files are kept in the app's data folder, and mpv reads that
 * folder for subtitle fonts.
 */

const CATALOGUE_URL = "https://fonts.google.com/metadata/fonts";
const CSS_URL = "https://fonts.googleapis.com/css2";
/**
 * An old browser identity. Google's CSS service then answers with TrueType
 * files, which mpv can read. Modern browsers get WOFF2, which it cannot.
 */
const OLD_BROWSER =
  "Mozilla/5.0 (Linux; Android 2.2) AppleWebKit/533.1 (KHTML, like Gecko) Version/4.0 Mobile Safari/533.1";
const CATALOGUE_TTL_MS = 24 * 60 * 60 * 1000;
const CATALOGUE_MAX_BYTES = 16 * 1024 * 1024;
const FONT_MAX_BYTES = 8 * 1024 * 1024;
const NAME = /^[\p{L}\p{N} .'_-]{1,64}$/u;

let catalogue: { at: number; families: string[] } | null = null;
let catalogueRequest: Promise<string[]> | null = null;
const installs = new Map<string, Promise<string>>();
let revision = 0;
export function subtitleFontRevision(): number {
  return revision;
}

/** Where installed subtitle fonts live. mpv is pointed here at start-up. */
export function subtitleFontsDirectory(): string {
  return join(app.getPath("userData"), "subtitle-fonts");
}

async function loadCatalogue(): Promise<string[]> {
  if (catalogue && Date.now() - catalogue.at < CATALOGUE_TTL_MS)
    return catalogue.families;
  if (catalogueRequest) return catalogueRequest;
  const request = fetchCatalogue();
  catalogueRequest = request;
  try {
    return await request;
  } finally {
    catalogueRequest = null;
  }
}

async function fetchCatalogue(): Promise<string[]> {
  if (catalogue && Date.now() - catalogue.at < CATALOGUE_TTL_MS)
    return catalogue.families;

  const response = await safeFetch({
    url: CATALOGUE_URL,
    maxBytes: CATALOGUE_MAX_BYTES,
  });
  if (response.status !== 200)
    throw new Error("Could not reach Google Fonts. Try again later.");

  // The metadata starts with a guard line before the JSON.
  const data = JSON.parse(response.body.slice(response.body.indexOf("{"))) as {
    familyMetadataList?: { family?: unknown }[];
  };

  const families = (data.familyMetadataList ?? [])
    .map((entry) => entry.family)
    .filter(
      (family): family is string =>
        typeof family === "string" && NAME.test(family),
    );

  catalogue = { at: Date.now(), families };
  return families;
}

/** Google Fonts whose names contain the text typed, at most 30 of them. */
export async function searchGoogleFonts(query: string): Promise<string[]> {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const families = await loadCatalogue();
  return families
    .filter((family) => family.toLowerCase().includes(needle))
    .slice(0, 30);
}

interface FontIndex {
  [family: string]: string;
}

function fileNameFor(family: string): string {
  return `${createHash("sha1").update(family).digest("hex").slice(0, 16)}.ttf`;
}

function readIndex(): FontIndex {
  try {
    const raw: unknown = JSON.parse(
      readFileSync(join(subtitleFontsDirectory(), "index.json"), "utf8"),
    );
    if (!raw || typeof raw !== "object") return {};
    const index: FontIndex = {};
    for (const [family, file] of Object.entries(raw)) {
      if (
        NAME.test(family) &&
        typeof file === "string" &&
        /^[a-f0-9]{16}\.ttf$/.test(file)
      )
        index[family] = file;
    }
    return index;
  } catch {
    return {};
  }
}

/** Families installed so far, that still have their file on disk. */
export function listInstalledSubtitleFonts(): string[] {
  const dir = subtitleFontsDirectory();
  return Object.entries(readIndex())
    .filter(([, file]) => existsSync(join(dir, file)))
    .map(([family]) => family)
    .sort((a, b) => a.localeCompare(b));
}

/** Font files start with one of these signatures; anything else is refused. */
function looksLikeTrueTypeOrOpenType(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  const tag = String.fromCharCode(...bytes.subarray(0, 4));
  return tag === "\u0000\u0001\u0000\u0000" || tag === "true" || tag === "OTTO";
}

/**
 * Download a Google font and make it available to subtitles.
 *
 * The family must be one in Google's list, so nothing outside it is fetched.
 */
export async function installGoogleFont(family: string): Promise<string> {
  if (!NAME.test(family)) throw new Error("Choose a valid font family.");
  if (listInstalledSubtitleFonts().includes(family)) return family;
  const pending = installs.get(family);
  if (pending) return pending;
  const request = downloadFont(family);
  installs.set(family, request);
  try {
    return await request;
  } finally {
    installs.delete(family);
  }
}

async function downloadFont(family: string): Promise<string> {
  const families = await loadCatalogue();
  if (!families.includes(family))
    throw new Error("That font is not in the Google Fonts list.");

  const cssUrl = `${CSS_URL}?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400&display=swap`;
  const css = await safeFetch({
    url: cssUrl,
    headers: { "User-Agent": OLD_BROWSER },
  });
  if (css.status !== 200)
    throw new Error(`Google Fonts did not offer ${family}.`);

  const match =
    /url\(\s*["']?(https:\/\/fonts\.gstatic\.com\/[^)\s"']+)["']?\s*\)/.exec(
      css.body,
    );
  if (!match?.[1]) throw new Error(`No font file found for ${family}.`);

  const bytes = await safeFetchBytes({
    url: match[1],
    maxBytes: FONT_MAX_BYTES,
  });
  if (!looksLikeTrueTypeOrOpenType(bytes))
    throw new Error(`${family} came in a format subtitles cannot use.`);

  const dir = subtitleFontsDirectory();
  mkdirSync(dir, { recursive: true });
  const file = fileNameFor(family);
  writeFileSync(join(dir, file), bytes);

  const index = readIndex();
  index[family] = file;
  const temporary = join(dir, "index.json.tmp");
  writeFileSync(temporary, JSON.stringify(index, null, 2));
  renameSync(temporary, join(dir, "index.json"));
  revision += 1;

  return family;
}
