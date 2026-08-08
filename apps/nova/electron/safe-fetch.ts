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

export class BlockedAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedAddressError";
  }
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
  } catch {
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

export interface SafeFetchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
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

  await assertPublicHost(parsed.hostname);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(parsed.toString(), {
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

    const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error("The response is larger than allowed.");
    }

    const text = await response.text();
    if (text.length > maxBytes) throw new Error("The response is larger than allowed.");

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: text,
    };
  } finally {
    clearTimeout(timer);
  }
}
