import { createDecipheriv, createHash } from "node:crypto";
import { z } from "zod";
import { streamResultSchema, type StreamResult } from "@vestra/extension-host";
import { safeFetch } from "./safe-fetch";

const HOST = "play.streamplay.co.in";
// Public player protocol, derived from app-v3.2.js _decx; this is not an account credential.
const PASSPHRASE = "F1r3b4Ll_GDP~5H";
type Fetch = typeof safeFetch;

function literal(raw: string): string {
  return raw.replace(
    /\\(?:x([\da-f]{2})|u([\da-f]{4})|([\\'"nrt]))/gi,
    (_m, x, u, ch) =>
      x || u
        ? String.fromCharCode(parseInt(x || u, 16))
        : ({ n: "\n", r: "\r", t: "\t" }[ch as string] ?? ch),
  );
}

/** Decode the observed literal dictionary format; never evaluate a page script. */
export function streamplayFields(html: string): {
  apx: string;
  qsx: string;
  kaken: string;
} {
  if (html.length > 1048576)
    throw new Error("Streamplay player page exceeds the size limit.");
  let text = html;
  const packed = html.match(
    /\}\('((?:\\.|[^'\\])*)',(\d+),(\d+),'((?:\\.|[^'\\])*)'\.split\('\|'\)/,
  );
  if (packed) {
    const radix = Number(packed[2]),
      count = Number(packed[3]);
    if (radix < 2 || radix > 36 || count > 1000)
      throw new Error("Unsupported Streamplay player dictionary.");
    const dictionary = literal(packed[4]!).split("|");
    const words = new Map<string, string>();
    for (let i = 0; i < count; i++)
      if (dictionary[i]) words.set(i.toString(radix), dictionary[i]!);
    let expanded = 0;
    text = literal(packed[1]!).replace(/\b[\da-z]+\b/g, (word) => {
      const replacement = words.get(word) ?? word;
      expanded += replacement.length;
      if (expanded > 524288)
        throw new Error("Decoded Streamplay player exceeds the size limit.");
      return replacement;
    });
    if (text.length > 524288)
      throw new Error("Decoded Streamplay player exceeds the size limit.");
  }
  const field = (name: string) => {
    const match = text.match(
      new RegExp(
        `window\\.${name}\\s*=\\s*(["'])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`,
      ),
    );
    if (!match)
      throw new Error(
        `Streamplay player is missing ${name}. The player format may have changed.`,
      );
    return literal(match[2]!);
  };
  const fields = {
    apx: field("apx"),
    qsx: field("qsx"),
    kaken: field("kaken"),
  };
  if (
    fields.apx.length > 8192 ||
    fields.qsx.length > 200 ||
    fields.kaken.length > 65536
  )
    throw new Error("Streamplay player fields exceed the size limit.");
  return fields;
}

export function streamplayConfiguration(envelope: unknown): { apiURL: string } {
  const value = z
    .object({
      ct: z.string().min(1).max(524288),
      s: z.string().regex(/^[a-f\d]{16}$/i),
      iv: z.string().regex(/^[a-f\d]{32}$/i),
    })
    .parse(envelope);
  const salt = Buffer.from(value.s, "hex"),
    password = Buffer.from(PASSPHRASE);
  let previous = Buffer.alloc(0),
    material = Buffer.alloc(0);
  while (material.length < 48) {
    previous = createHash("md5")
      .update(Buffer.concat([previous, password, salt]))
      .digest();
    material = Buffer.concat([material, previous]);
  }
  if (!/^[A-Za-z\d+/]+={0,2}$/.test(value.ct))
    throw new Error("Invalid Streamplay configuration encoding.");
  try {
    const cipher = createDecipheriv(
      "aes-256-cbc",
      material.subarray(0, 32),
      material.subarray(32, 48),
    );
    const plain = Buffer.concat([
      cipher.update(Buffer.from(value.ct, "base64")),
      cipher.final(),
    ]).toString("utf8");
    let decoded = JSON.parse(plain);
    if (typeof decoded === "string") decoded = JSON.parse(decoded);
    return z.object({ apiURL: z.string().url().max(2048) }).parse(decoded);
  } catch {
    throw new Error(
      "Streamplay player configuration could not be decoded. Its player protocol may have changed.",
    );
  }
}

export function streamplayEmbed(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(
    /No scraper implemented for embed host:\s*(https:\/\/[^\s"'<>]+)/i,
  );
  if (!match) return null;
  try {
    const url = new URL(match[1]!);
    return url.hostname === HOST &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      /^\/embed\/[A-Za-z\d_-]{1,200}\/?$/.test(url.pathname) &&
      (!url.port || url.port === "443")
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Fixed supported embed entrypoint; all derived requests retain guarded public HTTPS transport. */
export async function extractStreamplay(
  embed: string,
  server: string,
  referer: string,
  signal?: AbortSignal,
  fetch: Fetch = safeFetch,
): Promise<StreamResult> {
  if (
    streamplayEmbed(
      new Error(`No scraper implemented for embed host: ${embed}`),
    ) !== embed
  )
    throw new Error("Unsupported Streamplay embed address.");
  const headers = {
    "User-Agent": "Mozilla/5.0",
    Accept: "application/json, text/javascript, */*; q=0.01",
    Referer: embed,
    "X-Alt-Referer": referer,
  };
  const deadline = Date.now() + 6000;
  const request = async (
    url: string,
    method: "GET" | "POST" = "GET",
    body?: string,
  ) => {
    signal?.throwIfAborted();
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new Error("Streamplay extraction timed out. Try another mirror.");
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      (parsed.port && parsed.port !== "443")
    )
      throw new Error("Streamplay returned an invalid HTTPS endpoint.");
    const response = await fetch({
      url,
      method,
      body,
      headers: {
        ...headers,
        ...(method === "POST" ? { "Content-Type": "text/plain" } : {}),
      },
      maxBytes: 1048576,
      timeoutMs: Math.min(3000, remaining),
    });
    signal?.throwIfAborted();
    if (response.status < 200 || response.status >= 300)
      throw new Error(
        `Streamplay ${method === "POST" ? "video API" : "player"} HTTP ${response.status}.`,
      );
    return response.body;
  };
  const fields = streamplayFields(await request(embed));
  const prefix = new URL(Buffer.from(fields.apx, "base64").toString("utf8"));
  if (
    prefix.origin !== new URL(embed).origin ||
    prefix.pathname !== "/pl/" ||
    prefix.search ||
    prefix.hash ||
    new URL(embed).pathname.replace(/\/$/, "").split("/").at(-1) !== fields.qsx
  )
    throw new Error(
      "Streamplay returned an unexpected configuration endpoint.",
    );
  const configBody = await request(
    new URL(encodeURIComponent(fields.qsx), prefix).href,
  );
  if (!configBody.trim())
    throw new Error(
      "Streamplay returned no player configuration for this episode. Try another mirror.",
    );
  let envelope: unknown;
  try {
    envelope = JSON.parse(configBody);
  } catch {
    throw new Error(
      "Streamplay returned an invalid player configuration response.",
    );
  }
  const config = streamplayConfiguration(envelope);
  const endpoint = new URL(config.apiURL);
  if (endpoint.search || endpoint.hash)
    throw new Error("Streamplay returned an invalid video API base.");
  const raw = JSON.parse(
    await request(
      config.apiURL.replace(/\/?$/, "/") + "api/",
      "POST",
      fields.kaken,
    ),
  );
  const data = z
    .object({
      status: z.unknown().optional(),
      message: z.string().max(500).optional(),
      sources: z
        .array(
          z.object({
            file: z.string().url(),
            type: z.string().optional(),
            label: z.string().optional(),
          }),
        )
        .max(50)
        .default([]),
      tracks: z
        .array(
          z.object({
            file: z.string().url(),
            kind: z.string().optional(),
            label: z.string().optional(),
            language: z.string().optional(),
            default: z.boolean().optional(),
          }),
        )
        .max(50)
        .default([]),
    })
    .parse(raw);
  if (data.status === "error" || data.status === false)
    throw new Error("Streamplay reports that this episode is unavailable.");
  const subtitles = data.tracks
    .filter((track) => track.kind === "captions" || track.kind === "subtitles")
    .map((track, index) => ({
      id: `streamplay-${index}`,
      url: track.file,
      language: track.language || track.label || "und",
      title: track.label,
      isDefault: track.default,
    }));
  const videoSources = data.sources.flatMap((source) => {
    const path = new URL(source.file).pathname.toLowerCase(),
      type = (source.type ?? "").toLowerCase();
    const format =
      type.includes("mpegurl") ||
      type === "hls" ||
      type === "m3u8" ||
      path.endsWith(".m3u8")
        ? "hls"
        : type.includes("mp4") || path.endsWith(".mp4")
          ? "mp4"
          : null;
    return format
      ? [
          {
            url: source.file,
            type: format,
            quality: source.label || "auto",
            subtitles,
          },
        ]
      : [];
  });
  if (!videoSources.length)
    throw new Error(
      "Streamplay returned no supported HLS or MP4 video for this episode.",
    );
  return streamResultSchema.parse({
    server,
    headers: { Referer: embed, "User-Agent": headers["User-Agent"] },
    videoSources,
  });
}
