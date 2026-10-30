import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { isBlockedAddress } from "@vestra/core/net-guard";

/**
 * Outbound HTTP for URLs the user supplied.
 *
 * Extension registries are third-party addresses typed into a settings field,
 * and this process can reach things a browser tab cannot: the loopback
 * interface, the local network, and on a cloud host the metadata service. A
 * plain `fetch` here would let a mistyped or hostile registry URL turn Vestra
 * into a probe for whatever else is listening on the machine.
 *
 * Atlas had an equivalent guard; it went with the web app, and the transport
 * left behind said in a comment that private-range blocking was the next thing
 * it needed. This is that. Which addresses count as off limits lives in
 * `@vestra/core/net-guard`, where it is tested.
 *
 * What this is not: DNS rebinding remains possible in principle, because the
 * name is resolved for the check and resolved again by fetch. Closing that
 * needs an agent that dials the address already validated. The addresses are
 * checked here because it removes the whole class of accidents and most of the
 * deliberate ones, not because it is airtight.
 */

/** Generous for a JSON index, small enough that nothing is streamed into memory. */
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Retries are for temporary failures only. The wait doubles each time
 * (300 ms, then 600 ms), so a busy provider gets room to recover without the
 * user waiting long on one that is really down.
 */
const RETRY_LIMIT = 2;
const RETRY_BASE_MS = 300;

/** Network errors worth another try: the connection dropped, timed out, or DNS was busy. */
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/** HTTP answers that usually clear up on their own. */
const TRANSIENT_STATUS = new Set([429, 502, 503, 504]);

export class BlockedAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedAddressError";
  }
}

/**
 * A network failure, with the system code kept so callers and logs can tell
 * a dropped connection from a missing host.
 */
export class NetworkError extends Error {
  readonly code: string;
  readonly transient: boolean;

  constructor(message: string, code: string, transient: boolean) {
    super(message);
    this.name = "NetworkError";
    this.code = code;
    this.transient = transient;
  }
}

/** The system error code on an error object, or a plain label when there is none. */
function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : "unknown network error";
}

/**
 * Reject a hostname that resolves anywhere private.
 *
 * Every address is checked, not just the first. A name that returns one public
 * and one loopback address is not half safe.
 */
async function assertPublicHost(hostname: string): Promise<void> {
  // A literal address needs no lookup, and passing one to the resolver would
  // let a blocked literal through on some platforms.
  if (isIP(hostname) !== 0) {
    if (isBlockedAddress(hostname)) {
      throw new BlockedAddressError(`${hostname} is not a public address.`);
    }
    return;
  }

  let records;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    const code = codeOf(error);
    if (code === "EAI_AGAIN") {
      throw new NetworkError(
        `Could not resolve ${hostname} right now (EAI_AGAIN).`,
        code,
        true,
      );
    }
    throw new BlockedAddressError(`Could not resolve ${hostname}.`);
  }

  if (records.length === 0) {
    throw new BlockedAddressError(`${hostname} resolved to nothing.`);
  }

  for (const record of records) {
    if (isBlockedAddress(record.address)) {
      throw new BlockedAddressError(
        `${hostname} resolves to ${record.address}, which is not a public address.`,
      );
    }
  }
}

/**
 * Node reports every network failure as the same "fetch failed" message. The
 * real reason (DNS, refused, reset, TLS, timeout) sits in `cause`, so pull it
 * out and name the host. Only the host and the error code are kept: no path,
 * query or headers, since those can carry credentials.
 */
async function fetchOrExplain(url: URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url.toString(), init);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new NetworkError(
        `Request to ${url.hostname} timed out.`,
        "ETIMEDOUT",
        true,
      );
    }
    const code = codeOf((error as { cause?: unknown } | null)?.cause);
    throw new NetworkError(
      `Request to ${url.hostname} failed (${code}).`,
      code,
      TRANSIENT_CODES.has(code),
    );
  }
}

export interface SafeFetchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface AttemptOptions {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body: string | null;
  timeoutMs: number;
  maxBytes: number;
}

/** One request, start to finish, with its own timeout. */
async function attemptOnce(
  parsed: URL,
  options: AttemptOptions,
): Promise<SafeFetchResult> {
  const { method, headers, body, timeoutMs, maxBytes } = options;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new NetworkError(
          `Request to ${parsed.hostname} timed out.`,
          "ETIMEDOUT",
          true,
        ),
      );
    }, timeoutMs);
  });

  try {
    await Promise.race([assertPublicHost(parsed.hostname), timeout]);
    const response = await fetchOrExplain(parsed, {
      method,
      headers,
      body,
      signal: controller.signal,
      // Following a redirect would skip the address check for the hop that
      // actually gets fetched, which is the usual way past a guard like this.
      redirect: "error",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });

    const declared = Number.parseInt(
      response.headers.get("content-length") ?? "",
      10,
    );
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error("The response is larger than allowed.");
    }

    const text = await response.text();
    if (text.length > maxBytes)
      throw new Error("The response is larger than allowed.");

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: text,
    };
  } finally {
    clearTimeout(timer!);
  }
}

/** Log a retry with the host and reason only, never the path or query. */
async function waitBeforeRetry(
  hostname: string,
  reason: string,
  attempt: number,
): Promise<void> {
  const waitMs = RETRY_BASE_MS * 2 ** attempt;
  console.warn(
    `[safe-fetch] ${hostname} failed (${reason}); retry ${attempt + 1} of ${RETRY_LIMIT} in ${waitMs} ms.`,
  );
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

export async function safeFetch(input: {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string | null;
  timeoutMs?: number;
  maxBytes?: number;
}): Promise<SafeFetchResult> {
  const {
    url,
    method = "GET",
    headers = {},
    body = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
  } = input;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BlockedAddressError("That is not a valid URL.");
  }

  // Plain http would put the whole exchange on the wire in the clear, and
  // anything else — file:, data: — is not a network address at all.
  if (parsed.protocol !== "https:") {
    throw new BlockedAddressError("Only https addresses can be fetched.");
  }

  // Only GET is retried. A POST may already have been acted on by the server,
  // and sending it twice could do the thing twice.
  const retryable = method === "GET";
  const deadline = Date.now() + timeoutMs;
  const options: AttemptOptions = {
    method,
    headers,
    body,
    timeoutMs,
    maxBytes,
  };

  for (let attempt = 0; ; attempt++) {
    const outOfTries = !retryable || attempt >= RETRY_LIMIT;
    try {
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new NetworkError(
          `Request to ${parsed.hostname} timed out.`,
          "ETIMEDOUT",
          false,
        );
      const result = await attemptOnce(parsed, {
        ...options,
        timeoutMs: remaining,
      });
      if (
        outOfTries ||
        !TRANSIENT_STATUS.has(result.status) ||
        Date.now() + RETRY_BASE_MS * 2 ** attempt >= deadline
      )
        return result;
      await waitBeforeRetry(parsed.hostname, `HTTP ${result.status}`, attempt);
    } catch (error) {
      const transient = error instanceof NetworkError && error.transient;
      if (
        outOfTries ||
        !transient ||
        Date.now() + RETRY_BASE_MS * 2 ** attempt >= deadline
      )
        throw error;
      await waitBeforeRetry(
        parsed.hostname,
        (error as NetworkError).code,
        attempt,
      );
    }
  }
}
