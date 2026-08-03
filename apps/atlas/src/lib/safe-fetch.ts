import { lookup } from "node:dns/promises";
import net from "node:net";

/**
 * Guarded outbound fetch for user-supplied URLs.
 *
 * Any endpoint that takes a URL from the client and fetches it server-side is
 * an SSRF hole: the server sits inside the user's network (and, on desktop, on
 * localhost next to qBittorrent and Jellyfin), so an attacker-supplied URL
 * could reach services the browser never could. Everything here exists to keep
 * that from happening.
 */

const MAX_REDIRECTS = 3;

/** Reserved ranges that must never be reachable through a user-supplied URL. */
function isBlockedAddress(address: string): boolean {
  const version = net.isIP(address);

  if (version === 4) {
    const parts = address.split(".").map((part) => Number.parseInt(part, 10));
    const [a = 0, b = 0] = parts;

    if (a === 0) return true; // 0.0.0.0/8 "this network"
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("fe80")) return true; // link-local
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique-local
    // IPv4-mapped (::ffff:127.0.0.1) — re-check the embedded v4 address.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
    if (mapped?.[1]) return isBlockedAddress(mapped[1]);
    return false;
  }

  return false;
}

export class UnsafeUrlError extends Error {}

/**
 * Validate a URL and resolve it to a public address.
 *
 * Resolution happens here rather than relying on the hostname alone, because
 * a hostname the user controls can point at 127.0.0.1.
 */
async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("That is not a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http and https URLs are allowed.");
  }

  const host = url.hostname.replace(/^\[|]$/g, "");

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new UnsafeUrlError("Local addresses are not allowed.");
  }

  // Literal IPs skip DNS entirely.
  if (net.isIP(host) !== 0) {
    if (isBlockedAddress(host)) {
      throw new UnsafeUrlError("Private and loopback addresses are not allowed.");
    }
    return url;
  }

  let records: { address: string }[];
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new UnsafeUrlError("That host could not be resolved.");
  }

  // Reject if ANY record is private: a rebinding attack only needs one.
  if (records.length === 0 || records.some((record) => isBlockedAddress(record.address))) {
    throw new UnsafeUrlError("Private and loopback addresses are not allowed.");
  }

  return url;
}

export interface SafeFetchOptions {
  /** Abandon the request after this long. */
  timeoutMs?: number;
  /** Refuse bodies larger than this, streamed so a huge response can't be buffered. */
  maxBytes?: number;
  accept?: string;
}

/**
 * Fetch a user-supplied URL, following redirects manually so each hop is
 * re-validated. `fetch`'s own redirect handling would let a public URL bounce
 * to an internal one.
 */
export async function safeFetchText(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<string> {
  const { timeoutMs = 15_000, maxBytes = 8 * 1024 * 1024, accept = "*/*" } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let target = await assertPublicUrl(rawUrl);

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await fetch(target, {
        redirect: "manual",
        signal: controller.signal,
        headers: { accept },
        cache: "no-store",
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new UnsafeUrlError("Redirect without a destination.");
        target = await assertPublicUrl(new URL(location, target).toString());
        continue;
      }

      if (!response.ok) {
        throw new UnsafeUrlError(`Request failed with status ${response.status}.`);
      }

      const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new UnsafeUrlError("That response is too large.");
      }

      return await readCapped(response, maxBytes);
    }

    throw new UnsafeUrlError("Too many redirects.");
  } finally {
    clearTimeout(timer);
  }
}

/** Read a body chunk by chunk, aborting as soon as the cap is exceeded. */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  const parts: string[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new UnsafeUrlError("That response is too large.");
    }

    parts.push(decoder.decode(value, { stream: true }));
  }

  parts.push(decoder.decode());
  return parts.join("");
}
