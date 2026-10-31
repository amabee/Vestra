import { streamResultSchema, type StreamResult } from "@vestra/extension-host";
import { chooseEpisodeServer } from "./provider-compat";

export function providerError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const host = message.match(
    /No scraper implemented for embed host:\s*(https:\/\/\S+)/i,
  );
  if (host) {
    try {
      return `This extension cannot extract video from ${new URL(host[1]!).hostname}.`;
    } catch {
      /* Keep the provider error. */
    }
  }
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/https?:\/\/[^\s"']+/g, (url) => {
      try {
        return new URL(url).hostname;
      } catch {
        return "upstream server";
      }
    })
    .slice(0, 400);
}

/**
 * Total time allowed for all mirrors together. They are started at the same
 * time, so the first one that works wins and a slow mirror cannot hold the
 * player on its loader for long.
 */
const MIRROR_BUDGET_MS = 40_000;

/**
 * After the first mirror works, the others get this long to finish. Every
 * mirror that works in that window is kept as a backup for recovery.
 */
const BACKUP_GRACE_MS = 3_000;

/** A preferred mirror is tried first, rather than becoming a single point of failure. */
export async function resolveEpisodeServers(
  servers: string[],
  preferred: string | undefined,
  resolve: (server: string) => Promise<unknown>,
  probe: (result: StreamResult) => Promise<StreamResult> = async (result) =>
    result,
  signal?: AbortSignal,
  excludeServers: readonly string[] = [],
): Promise<StreamResult[]> {
  signal?.throwIfAborted();
  const first = chooseEpisodeServer(
    servers,
    preferred && servers.includes(preferred) ? preferred : undefined,
  );
  const failures: string[] = [];
  const started = Date.now();
  const candidates = [...new Set([first, ...servers])]
    .slice(0, 8)
    .filter((server) => !excludeServers.includes(server));

  const tryMirror = async (server: string): Promise<StreamResult> => {
    signal?.throwIfAborted();
    const mirrorStarted = Date.now();
    try {
      const raw = (await resolve(server)) as Omit<
        StreamResult,
        "videoSources"
      > & {
        videoSources: Array<
          Omit<StreamResult["videoSources"][number], "type"> & { type: string }
        >;
      };
      const result = streamResultSchema.parse({
        ...raw,
        videoSources: raw.videoSources?.map((video, i) => ({
          ...video,
          type: video.type === "m3u8" ? "hls" : video.type,
          quality: video.quality || "auto",
          subtitles:
            video.subtitles?.map((sub, j) => ({
              ...sub,
              id: sub.id || `sub-${i}-${j}`,
            })) ?? [],
        })),
      });
      const checked = streamResultSchema.parse(await probe(result));
      console.info(
        `[nova] mirror ${server} ready in ${Date.now() - mirrorStarted}ms (total ${Date.now() - started}ms)`,
      );
      return { ...checked, server };
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn(
        `[nova] mirror ${server} failed after ${Date.now() - mirrorStarted}ms`,
      );
      throw new Error(`${server}: ${providerError(error)}`);
    }
  };

  // Start every mirror at once. Keep every one that works, the first first.
  const successes: StreamResult[] = [];
  const working = await new Promise<StreamResult[]>((done) => {
    let pending = candidates.length;
    let finished = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(budget);
      if (grace) clearTimeout(grace);
      signal?.removeEventListener("abort", finish);
      done([...successes]);
    };
    const budget = setTimeout(() => {
      failures.push("Stopped waiting for mirrors after the time limit.");
      finish();
    }, MIRROR_BUDGET_MS);
    signal?.addEventListener("abort", finish, { once: true });
    if (signal?.aborted || candidates.length === 0) finish();
    const settle = () => {
      pending -= 1;
      if (pending === 0) finish();
    };
    for (const server of candidates) {
      tryMirror(server).then(
        (result) => {
          if (finished) return;
          successes.push(result);
          // The first winner starts a short window for the other mirrors.
          if (!grace) grace = setTimeout(finish, BACKUP_GRACE_MS);
          settle();
        },
        (error: unknown) => {
          if (finished) return;
          failures.push(error instanceof Error ? error.message : String(error));
          settle();
        },
      );
    }
  });
  signal?.throwIfAborted();
  if (working.length) return working;
  throw new Error(
    `No playable mirror was available. ${failures.join(" ")} Try another extension or check for an extension update.`,
  );
}
