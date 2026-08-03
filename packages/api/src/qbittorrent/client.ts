import { getServerEnv, isQbittorrentConfigured } from "@vestra/config";
import type {
  AddTorrentInput,
  Torrent,
  TorrentFile,
  TorrentState,
  QbittorrentStatus,
} from "@vestra/types";

import { ProviderError, ProviderNotConfiguredError } from "../errors";
import { buildUrl, type RequestBody } from "../http";

/**
 * qBittorrent Web API (v2) client.
 *
 * Drives the user's OWN qBittorrent instance: list transfers, add a magnet or
 * .torrent URL, pause/resume/delete, and read completed file paths so finished
 * downloads can be handed to the local library.
 *
 * Vestra ships no trackers, indexers or content search. It only controls a
 * client you configure and point it at.
 *
 * Server-only: credentials must never reach the browser.
 */

const AUTH_PATH = "api/v2/auth/login";
const SESSION_TTL_MS = 30 * 60 * 1000;

interface Session {
  cookie: string;
  expiresAt: number;
}

let session: Session | null = null;

interface Connection {
  baseUrl: string;
  username: string;
  password: string;
}

function getConnection(): Connection {
  if (!isQbittorrentConfigured()) {
    throw new ProviderNotConfiguredError(
      "qbittorrent",
      "Set QBITTORRENT_URL and QBITTORRENT_USERNAME in your environment.",
    );
  }

  const env = getServerEnv();
  const rawUrl = env.QBITTORRENT_URL as string;

  // Validate up front: this URL is used to build outbound requests, so an
  // unvalidated value would be an SSRF vector.
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ProviderError("qbittorrent", "QBITTORRENT_URL is not a valid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ProviderError("qbittorrent", "QBITTORRENT_URL must use http or https.");
  }

  return {
    baseUrl: parsed.origin + parsed.pathname.replace(/\/$/, ""),
    username: env.QBITTORRENT_USERNAME as string,
    password: env.QBITTORRENT_PASSWORD ?? "",
  };
}

/* -----------------------------------------------------------------------------
 * Session handling — qBittorrent issues an SID cookie that fetch won't persist.
 * -------------------------------------------------------------------------- */

async function login(connection: Connection): Promise<string> {
  const body = new URLSearchParams({
    username: connection.username,
    password: connection.password,
  });

  let response: Response;
  try {
    response = await fetch(buildUrl(connection.baseUrl, AUTH_PATH), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // qBittorrent rejects cross-origin requests unless Referer matches.
        Referer: connection.baseUrl,
      },
      body,
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch (error) {
    throw new ProviderError("qbittorrent", "Could not reach the qBittorrent Web UI.", {
      cause: error,
    });
  }

  if (!response.ok) {
    throw new ProviderError("qbittorrent", `qBittorrent login failed (${response.status}).`, {
      status: response.status,
    });
  }

  const text = await response.text();
  if (text.trim() !== "Ok.") {
    throw new ProviderError(
      "qbittorrent",
      "qBittorrent rejected the credentials. Check the username and password.",
      { status: 403 },
    );
  }

  const setCookie = response.headers.get("set-cookie");
  const sid = setCookie ? /SID=([^;]+)/.exec(setCookie)?.[1] : null;

  if (!sid) {
    throw new ProviderError("qbittorrent", "qBittorrent did not return a session cookie.");
  }

  return `SID=${sid}`;
}

async function getSessionCookie(connection: Connection, force = false): Promise<string> {
  const now = Date.now();
  if (!force && session && session.expiresAt > now) {
    return session.cookie;
  }

  const cookie = await login(connection);
  session = { cookie, expiresAt: now + SESSION_TTL_MS };
  return cookie;
}

/** Invalidate the cached session (used after a 403 to force re-login). */
export function resetQbittorrentSession(): void {
  session = null;
}

async function qbRequest(
  path: string,
  init: {
    method?: "GET" | "POST";
    query?: Record<string, string | undefined>;
    body?: RequestBody;
  } = {},
  retryOnAuthFailure = true,
): Promise<Response> {
  const connection = getConnection();
  const cookie = await getSessionCookie(connection);
  const url = buildUrl(connection.baseUrl, path, init.query ?? {});

  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      headers: { Cookie: cookie, Referer: connection.baseUrl },
      ...(init.body ? { body: init.body } : {}),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (error) {
    throw new ProviderError("qbittorrent", "Could not reach the qBittorrent Web UI.", {
      cause: error,
    });
  }

  // The session expired server-side — re-authenticate once, then give up.
  if (response.status === 403 && retryOnAuthFailure) {
    resetQbittorrentSession();
    await getSessionCookie(connection, true);
    return qbRequest(path, init, false);
  }

  if (!response.ok) {
    throw new ProviderError(
      "qbittorrent",
      `qBittorrent responded ${response.status} ${response.statusText}.`,
      { status: response.status },
    );
  }

  return response;
}

/* -----------------------------------------------------------------------------
 * State mapping — qBittorrent 4.x and 5.x use different names for paused states.
 * -------------------------------------------------------------------------- */

function mapState(raw: string): TorrentState {
  switch (raw) {
    case "downloading":
    case "forcedDL":
    case "metaDL":
      return "downloading";
    case "uploading":
    case "forcedUP":
      return "seeding";
    case "pausedDL":
    case "stoppedDL":
      return "paused";
    case "pausedUP":
    case "stoppedUP":
      return "completed";
    case "queuedDL":
    case "queuedUP":
      return "queued";
    case "checkingDL":
    case "checkingUP":
    case "checkingResumeData":
    case "allocating":
    case "moving":
      return "checking";
    case "stalledDL":
    case "stalledUP":
      return "stalled";
    case "error":
    case "missingFiles":
      return "error";
    default:
      return "unknown";
  }
}

interface RawTorrent {
  hash: string;
  name: string;
  state: string;
  progress: number;
  size: number;
  downloaded: number;
  dlspeed: number;
  upspeed: number;
  eta: number;
  save_path: string;
  content_path?: string;
  category?: string;
  tags?: string;
  added_on?: number;
  completion_on?: number;
}

function mapTorrent(raw: RawTorrent): Torrent {
  // qBittorrent reports eta 8640000 (100 days) to mean "unknown".
  const eta = raw.eta > 0 && raw.eta < 8_640_000 ? raw.eta : null;

  return {
    hash: raw.hash,
    name: raw.name,
    state: mapState(raw.state),
    progress: Math.min(1, Math.max(0, raw.progress)),
    sizeBytes: raw.size,
    downloadedBytes: raw.downloaded,
    downloadSpeed: raw.dlspeed,
    uploadSpeed: raw.upspeed,
    etaSeconds: eta,
    savePath: raw.save_path,
    contentPath: raw.content_path ?? null,
    category: raw.category ?? "",
    tags: raw.tags ? raw.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    // qBittorrent uses seconds; Vestra uses milliseconds throughout.
    addedAt: raw.added_on ? raw.added_on * 1000 : null,
    completedAt: raw.completion_on && raw.completion_on > 0 ? raw.completion_on * 1000 : null,
  };
}

/* -----------------------------------------------------------------------------
 * Public API
 * -------------------------------------------------------------------------- */

export async function getQbittorrentStatus(): Promise<QbittorrentStatus> {
  try {
    const response = await qbRequest("api/v2/app/version");
    const version = (await response.text()).trim();
    return { connected: true, version, error: null };
  } catch (error) {
    return {
      connected: false,
      version: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export interface ListTorrentsOptions {
  filter?: "all" | "downloading" | "completed" | "paused" | "active" | "inactive";
  category?: string;
  sort?: string;
  reverse?: boolean;
}

export async function listTorrents(options: ListTorrentsOptions = {}): Promise<Torrent[]> {
  const response = await qbRequest("api/v2/torrents/info", {
    query: {
      filter: options.filter ?? "all",
      category: options.category,
      sort: options.sort ?? "added_on",
      reverse: String(options.reverse ?? true),
    },
  });

  const raw = (await response.json()) as RawTorrent[];
  return raw.map(mapTorrent);
}

export async function getTorrentFiles(hash: string): Promise<TorrentFile[]> {
  const response = await qbRequest("api/v2/torrents/files", { query: { hash } });

  const raw = (await response.json()) as {
    index?: number;
    name: string;
    size: number;
    progress: number;
    priority: number;
  }[];

  return raw.map((file, index) => ({
    index: file.index ?? index,
    name: file.name,
    sizeBytes: file.size,
    progress: Math.min(1, Math.max(0, file.progress)),
    priority: file.priority,
  }));
}

/**
 * Add one or more magnet URIs / .torrent URLs.
 * Only http(s) and magnet schemes are accepted — anything else is rejected so a
 * crafted value can't reach the local filesystem via `file:`.
 */
export async function addTorrent(input: AddTorrentInput): Promise<void> {
  for (const url of input.urls) {
    const isAllowed =
      url.startsWith("magnet:") || url.startsWith("http://") || url.startsWith("https://");
    if (!isAllowed) {
      throw new ProviderError(
        "qbittorrent",
        "Only magnet links and http(s) .torrent URLs can be added.",
      );
    }
  }

  const form = new FormData();
  form.append("urls", input.urls.join("\n"));
  if (input.savePath) form.append("savepath", input.savePath);
  if (input.category) form.append("category", input.category);
  if (input.tags?.length) form.append("tags", input.tags.join(","));
  form.append("paused", String(input.paused));

  await qbRequest("api/v2/torrents/add", { method: "POST", body: form });
}

async function torrentAction(paths: readonly string[], hashes: readonly string[]): Promise<void> {
  const body = new URLSearchParams({ hashes: hashes.join("|") });

  let lastError: unknown = null;
  // qBittorrent 5.x renamed pause/resume to stop/start; try each in turn.
  for (const path of paths) {
    try {
      await qbRequest(path, {
        method: "POST",
        body,
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ProviderError("qbittorrent", "Torrent action failed.");
}

export async function pauseTorrents(hashes: readonly string[]): Promise<void> {
  await torrentAction(["api/v2/torrents/stop", "api/v2/torrents/pause"], hashes);
}

export async function resumeTorrents(hashes: readonly string[]): Promise<void> {
  await torrentAction(["api/v2/torrents/start", "api/v2/torrents/resume"], hashes);
}

export async function deleteTorrents(
  hashes: readonly string[],
  deleteFiles = false,
): Promise<void> {
  await qbRequest("api/v2/torrents/delete", {
    method: "POST",
    body: new URLSearchParams({
      hashes: hashes.join("|"),
      deleteFiles: String(deleteFiles),
    }),
  });
}
