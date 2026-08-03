import { PROVIDER_TIMEOUT_MS } from "@vestra/config/constants";
import type { MediaSource } from "@vestra/types";

import { ProviderError } from "./errors";

/**
 * Bodies Vestra actually sends. Typed explicitly instead of using the DOM's
 * `BodyInit`, which isn't available under Node-only lib settings — and whose
 * definition differs between the Node and DOM type sets.
 */
export type RequestBody = string | FormData | URLSearchParams;

export interface RequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  /** Query params; `undefined` and `null` entries are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: RequestBody | null;
  timeoutMs?: number;
  /** Next.js fetch cache revalidation window, in seconds. */
  revalidate?: number | false;
  signal?: AbortSignal;
}

/** Next.js augments RequestInit with a `next` field; typed here to avoid `any`. */
type NextRequestInit = RequestInit & {
  next?: { revalidate?: number | false };
};

export function buildUrl(
  base: string,
  path: string,
  query: RequestOptions["query"] = {},
): string {
  const url = new URL(path.replace(/^\//, ""), base.endsWith("/") ? base : `${base}/`);

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

/**
 * JSON fetch with a hard timeout and provider-tagged errors.
 *
 * Response bodies are never echoed back verbatim into thrown messages beyond a
 * short excerpt, so upstream errors can't leak credentials into logs or the UI.
 */
export async function requestJson<T>(
  source: MediaSource,
  url: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    method = "GET",
    headers = {},
    body = null,
    timeoutMs = PROVIDER_TIMEOUT_MS,
    revalidate,
    signal,
  } = options;

  const init: NextRequestInit = {
    method,
    headers: { Accept: "application/json", ...headers },
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  };

  if (body !== null) init.body = body;
  if (revalidate !== undefined) init.next = { revalidate };

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const message =
      name === "TimeoutError" || name === "AbortError"
        ? `Request to ${source} timed out after ${timeoutMs}ms.`
        : `Could not reach ${source}.`;
    throw new ProviderError(source, message, { cause: error });
  }

  if (!response.ok) {
    const excerpt = (await response.text().catch(() => "")).slice(0, 200);
    throw new ProviderError(
      source,
      `${source} responded ${response.status} ${response.statusText}${
        excerpt ? `: ${excerpt}` : ""
      }`,
      { status: response.status },
    );
  }

  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new ProviderError(source, `${source} returned malformed JSON.`, {
      status: response.status,
      cause: error,
    });
  }
}

/**
 * Run provider calls concurrently, returning a result-or-error per entry.
 * Used by universal search so a single slow source can't stall the response.
 */
export async function settleAll<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
): Promise<Array<{ ok: true; value: T } | { ok: false; error: unknown }>> {
  const settled = await Promise.allSettled(tasks.map((task) => task()));
  return settled.map((result) =>
    result.status === "fulfilled"
      ? ({ ok: true, value: result.value } as const)
      : ({ ok: false, error: result.reason } as const),
  );
}
