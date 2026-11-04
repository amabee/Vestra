import type { QueryClient } from "@tanstack/react-query";
import { bridge } from "./bridge";

/** Hydrate the queries the shell and saved shelves actually consume. No remote discovery. */
export async function warmStartupCache(
  client: QueryClient,
  timeoutMs = 8000,
): Promise<number> {
  const jobs = [
    { queryKey: ["settings"], queryFn: bridge.settings.get },
    { queryKey: ["library"], queryFn: bridge.library.files },
    { queryKey: ["history"], queryFn: bridge.history.list },
    { queryKey: ["watchlist"], queryFn: bridge.watchlist.list },
    { queryKey: ["progress"], queryFn: bridge.progress.all },
    { queryKey: ["bookmarks"], queryFn: bridge.bookmarks.all },
  ];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.allSettled(
        jobs.map((job) => client.fetchQuery<unknown>({ ...job, retry: false })),
      ).then(
        (results) =>
          results.filter((result) => result.status === "rejected").length,
      ),
      new Promise<number>((resolve) => {
        timer = setTimeout(() => resolve(jobs.length), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
