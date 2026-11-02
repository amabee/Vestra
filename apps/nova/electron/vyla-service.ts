import type {
  StreamSourceProvider,
  StreamResult,
  SubtitleTrack,
} from "@vestra/extension-host";
import type { ProviderContext } from "@vestra/provider-sdk";
import {
  withSourceCatalogue,
  type SourceCatalogue,
} from "./catalogue-stream-source";
import { assertPublicHost } from "./safe-fetch";

const LOOPBACK = new Set(["127.0.0.1", "[::1]"]);
export function vylaServiceUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw Error("Vyla requires a valid service URL.");
  }
  if (
    value.length > 2048 ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" && LOOPBACK.has(url.hostname))
    ) ||
    !["/", "/api", "/api/"].includes(url.pathname)
  )
    throw Error(
      "Vyla requires public HTTPS or exact loopback HTTP, with an optional /api prefix and no URL credentials.",
    );
  url.pathname = url.pathname.replace(/\/?$/, "/");
  return url;
}
interface Transport {
  fetch: typeof globalThis.fetch;
  publicHost: (hostname: string) => Promise<void>;
}
const transport: Transport = {
  fetch: (...args) => fetch(...args),
  publicHost: assertPublicHost,
};

function titleId(value: string) {
  const match = /^(movie|tv)\|([1-9]\d{0,9})$/.exec(value);
  if (!match) throw Error("Invalid Vyla catalogue identity.");
  return { kind: match[1] as "movie" | "tv", id: match[2]!, key: value };
}
function episodeId(value: string) {
  const match =
    /^((?:movie|tv)\|[1-9]\d{0,9})\|s(0|[1-9]\d{0,2})\|e(0|[1-9]\d{0,3})$/.exec(
      value,
    );
  if (!match) throw Error("Invalid Vyla episode identity.");
  const title = titleId(match[1]!);
  const season = Number(match[2]),
    episode = Number(match[3]);
  if (title.kind === "movie" ? season !== 0 || episode !== 0 : episode < 1)
    throw Error("Invalid Vyla episode numbering.");
  return { ...title, season, episode };
}
function mediaUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length > 2048)
    throw Error("Invalid Vyla media URL.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw Error("Vyla media must use HTTPS without URL credentials.");
  return url;
}
async function mediaType(
  url: URL,
  signal: AbortSignal,
  io: Transport,
): Promise<"hls" | "mp4"> {
  await io.publicHost(url.hostname);
  signal.throwIfAborted();
  const response = await io.fetch(url, {
    signal,
    redirect: "error",
    credentials: "omit",
    headers: { Range: "bytes=0-16383" },
  });
  if (![200, 206].includes(response.status) || !response.body) {
    await response.body?.cancel();
    throw Error("Vyla candidate could not be verified.");
  }
  const reader = response.body.getReader();
  let bytes = new Uint8Array();
  try {
    while (bytes.length < 16384) {
      const { value, done } = await reader.read();
      if (done) break;
      const next = new Uint8Array(Math.min(16384, bytes.length + value.length));
      next.set(bytes);
      next.set(value.subarray(0, next.length - bytes.length), bytes.length);
      bytes = next;
      if (
        bytes.length >= 8 &&
        new TextDecoder().decode(bytes.subarray(4, 8)) === "ftyp"
      )
        return "mp4";
      const text = new TextDecoder().decode(bytes).trimStart();
      if (text.startsWith("#EXTM3U") && /#EXT(?:INF|-X-STREAM-INF):/.test(text))
        return "hls";
      if (bytes.length >= 512 && !text.startsWith("#EXTM3U")) break;
    }
    throw Error("Vyla returned an unsupported media format.");
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Host-owned connector: this does not grant service access to extension code. */
export function createVylaService(options: {
  url: string;
  token?: string;
  catalogue?: SourceCatalogue;
  transport?: Transport;
}): StreamSourceProvider {
  const base = vylaServiceUrl(options.url),
    io = options.transport ?? transport;
  if (options.token && !/^[\x21-\x7e]{1,4096}$/.test(options.token))
    throw Error("Invalid Vyla service token.");
  const source: StreamSourceProvider = {
    id: "service-vyla",
    name: "Vyla · self-hosted",
    kinds: ["movie", "tv"],
    search: async () => {
      throw Error("Vyla requires Vestra's configured TMDb catalogue.");
    },
    async getEpisodes(id) {
      const title = titleId(id);
      return title.kind === "movie"
        ? [{ id: `${id}|s0|e0`, animeId: id, number: 1, title: "Watch movie" }]
        : [];
    },
    async getStreams(id, context, playbackOptions) {
      const entry = episodeId(id),
        url = new URL(entry.kind, base);
      url.searchParams.set("id", entry.id);
      if (entry.kind === "tv") {
        url.searchParams.set("season", String(entry.season));
        url.searchParams.set("episode", String(entry.episode));
      }
      return resolve(url, context, playbackOptions?.excludeServers ?? []);
    },
  };
  async function resolve(
    url: URL,
    context: ProviderContext | undefined,
    excluded: string[],
  ): Promise<StreamResult[]> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.min(15000, context?.timeoutMs ?? 15000),
    );
    const abort = () => controller.abort();
    context?.signal?.addEventListener("abort", abort, { once: true });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      context?.signal?.throwIfAborted();
      if (!LOOPBACK.has(base.hostname)) await io.publicHost(base.hostname);
      controller.signal.throwIfAborted();
      const response = await io.fetch(url, {
        signal: controller.signal,
        redirect: "error",
        credentials: "omit",
        headers: {
          Accept: "text/event-stream",
          ...(options.token
            ? { Authorization: `Bearer ${options.token}` }
            : {}),
        },
      });
      if (
        response.status !== 200 ||
        !response.headers
          .get("content-type")
          ?.toLowerCase()
          .startsWith("text/event-stream") ||
        !response.body
      ) {
        await response.body?.cancel();
        throw Error(
          `Vyla service returned ${response.status}; expected an event stream.`,
        );
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "",
        size = 0,
        events = 0,
        sawCandidate = false;
      let subtitles: SubtitleTrack[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 256 * 1024)
          throw Error("Vyla event stream exceeds the response limit.");
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(
          /\r\n/g,
          "\n",
        );
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (frame.length > 65536 || ++events > 100)
            throw Error("Vyla event limit exceeded.");
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).replace(/^ /, ""))
            .join("\n");
          if (!data) continue;
          let event;
          try {
            event = JSON.parse(data);
          } catch {
            throw Error("Vyla returned malformed event data.");
          }
          if (!event || typeof event !== "object" || Array.isArray(event))
            throw Error("Invalid Vyla event.");
          if (event.type === "meta" && Array.isArray(event.subtitles)) {
            subtitles = event.subtitles
              .slice(0, 50)
              .flatMap((row: unknown, index: number) => {
                if (!row || typeof row !== "object") return [];
                const track = row as { file?: unknown; label?: unknown };
                try {
                  return [
                    {
                      id: `vyla-${index}`,
                      url: mediaUrl(track.file).href,
                      language:
                        typeof track.label === "string"
                          ? track.label.slice(0, 100) || "Unknown"
                          : "Unknown",
                    },
                  ];
                } catch {
                  return [];
                }
              });
          }
          if (event.type === "done")
            throw Error(
              sawCandidate
                ? "Vyla has no untried supported source for this entry."
                : "Vyla has no playable source for this entry.",
            );
          if (event.type !== "source") continue;
          const candidate = event.source;
          if (
            !candidate ||
            typeof candidate.source !== "string" ||
            !/^[a-zA-Z0-9._-]{1,80}$/.test(candidate.source)
          )
            continue;
          sawCandidate = true;
          const server = `Vyla:${candidate.source}`;
          if (excluded.includes(server)) continue;
          try {
            const media = mediaUrl(candidate.url);
            const type = await mediaType(
              media,
              AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
              io,
            );
            // Resolve immediately; cancel the remaining SSE work. Mirror recovery
            // makes a fresh request excluding attempted source keys.
            return [
              {
                server,
                videoSources: [
                  { url: media.href, quality: "auto", type, subtitles },
                ],
              },
            ];
          } catch {
            controller.signal.throwIfAborted();
          }
        }
        if (buffer.length > 65536)
          throw Error("Vyla event frame exceeds the response limit.");
      }
      throw Error("Vyla event stream ended without a usable source.");
    } catch (error) {
      if (controller.signal.aborted || context?.signal?.aborted)
        throw Error("Vyla request was cancelled or timed out.");
      // Transport exceptions can include signed query strings: do not forward them.
      if (error instanceof Error && error.message.startsWith("Vyla "))
        throw error;
      throw Error(
        "Vyla service could not be reached. Check its address and deployment.",
      );
    } finally {
      clearTimeout(timeout);
      controller.abort();
      context?.signal?.removeEventListener("abort", abort);
      await reader?.cancel().catch(() => undefined);
    }
  }
  return withSourceCatalogue(
    source,
    async (method, args) => {
      if (method === "matchCatalogue") return args[0];
      if (method === "getEpisodes") return args[1];
      throw Error("Unsupported Vyla catalogue operation.");
    },
    options.catalogue,
  );
}
