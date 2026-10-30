import type { StreamResult } from "@vestra/extension-host";
import { automaticVariant } from "./mpv/stream-policy";
import { safeFetch } from "./safe-fetch";

/** Validate the automatic choice first; don't delay playback to probe every quality. */
export async function probePlayableStream(
  result: StreamResult,
  fetcher: typeof safeFetch = safeFetch,
  signal?: AbortSignal,
): Promise<StreamResult> {
  let remaining = result.videoSources;
  const rejected = new Set<string>();
  const failures: string[] = [];
  while (remaining.length) {
    signal?.throwIfAborted();
    const choice = automaticVariant(
      remaining.map((video) => ({ ...video, label: video.quality })),
    );
    remaining = remaining.filter((video) => video.url !== choice.url);
    try {
      if (choice.type === "hls") {
        const response = await fetcher({
          url: choice.url,
          headers: { ...result.headers, ...choice.headers },
          maxBytes: 1048576,
          timeoutMs: 7000,
        });
        signal?.throwIfAborted();
        if (response.status < 200 || response.status >= 300)
          throw Error(`Video manifest HTTP ${response.status}`);
        if (!response.body.trimStart().startsWith("#EXTM3U"))
          throw Error(
            "The server returned a web page instead of an HLS video manifest.",
          );
      }
      return {
        ...result,
        videoSources: result.videoSources.filter(
          (video) => !rejected.has(video.url),
        ),
      };
    } catch (error) {
      signal?.throwIfAborted();
      rejected.add(choice.url);
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw Error(
    failures.join(" ") || "This server returned no supported videos.",
  );
}
