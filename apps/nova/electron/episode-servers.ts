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

/** A preferred mirror is tried first, rather than becoming a single point of failure. */
export async function resolveEpisodeServers(
  servers: string[],
  preferred: string | undefined,
  resolve: (server: string) => Promise<unknown>,
  probe: (result: StreamResult) => Promise<StreamResult> = async (result) =>
    result,
  signal?: AbortSignal,
): Promise<StreamResult[]> {
  const first = chooseEpisodeServer(
    servers,
    preferred && servers.includes(preferred) ? preferred : undefined,
  );
  const failures: string[] = [];
  for (const server of [...new Set([first, ...servers])].slice(0, 8)) {
    signal?.throwIfAborted();
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
      signal?.throwIfAborted();
      return [checked];
    } catch (error) {
      if (signal?.aborted) throw error;
      failures.push(`${server}: ${providerError(error)}`);
    }
  }
  throw new Error(
    `No playable mirror was available. ${failures.join(" ")} Try another extension or check for an extension update.`,
  );
}
