import { can, type PermissionGrant } from "./permissions";

/**
 * The only way out of the sandbox.
 *
 * A community extension never touches the network stack. It calls this, and
 * this decides. Policy lives here; the actual request is delegated to a
 * transport the application supplies — which is also where the SSRF guard sits,
 * so the two concerns compose instead of duplicating.
 */

/** Implemented by the host. In Atlas this is backed by `safeFetchText`. */
export interface GuardedTransport {
  request(input: {
    url: string;
    method: "GET" | "POST";
    headers: Record<string, string>;
    body: string | null;
    timeoutMs: number;
    maxBytes: number;
  }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
}

export interface BrokeredRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

export interface BrokeredResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface NetworkLimits {
  timeoutMs: number;
  maxResponseBytes: number;
  maxRequestBytes: number;
  /** Requests per extension, per minute. */
  requestsPerMinute: number;
}

export const DEFAULT_NETWORK_LIMITS: NetworkLimits = {
  timeoutMs: 10_000,
  maxResponseBytes: 4 * 1024 * 1024,
  maxRequestBytes: 256 * 1024,
  requestsPerMinute: 120,
};

/**
 * Headers an extension may set.
 *
 * An allowlist rather than a blocklist. The blocked set is the interesting
 * part: `cookie` and `authorization` would let an extension attach credentials
 * it should never have, and `host` would let it aim a request somewhere other
 * than the URL it was checked against.
 */
const ALLOWED_REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "content-type",
  "user-agent",
]);

export class NetworkDeniedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "NetworkDeniedError";
  }
}

/** Exact hostname match. A subdomain is a different host and needs its own grant. */
function hostAllowed(grant: PermissionGrant, hostname: string): boolean {
  return grant.allowedHosts.includes(hostname.toLowerCase());
}

/**
 * Build the `fetch` a single extension sees.
 *
 * Returns null when the extension has no network permission, so the bridge can
 * omit the method entirely rather than exposing one that always throws.
 */
export function createBrokeredFetch(
  grant: PermissionGrant,
  transport: GuardedTransport,
  limits: NetworkLimits = DEFAULT_NETWORK_LIMITS,
): ((request: BrokeredRequest) => Promise<BrokeredResponse>) | null {
  if (!can(grant, "network")) return null;

  // Fixed-window counter. Crude, but the goal is to stop a runaway loop from
  // hammering a third party under the user's IP, not to price the API.
  let windowStart = Date.now();
  let sent = 0;

  return async function brokeredFetch(request: BrokeredRequest): Promise<BrokeredResponse> {
    const now = Date.now();
    if (now - windowStart >= 60_000) {
      windowStart = now;
      sent = 0;
    }
    if (++sent > limits.requestsPerMinute) {
      throw new NetworkDeniedError("Request rate limit exceeded.");
    }

    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      throw new NetworkDeniedError("Invalid URL.");
    }

    // https only. Community code does not get to send the user's requests in
    // the clear, and a downgrade is the cheapest way to leak one.
    if (url.protocol !== "https:") {
      throw new NetworkDeniedError("Only https requests are allowed.");
    }

    if (!hostAllowed(grant, url.hostname)) {
      throw new NetworkDeniedError(
        `${url.hostname} is not one of the hosts you allowed for this extension.`,
      );
    }

    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "POST") {
      throw new NetworkDeniedError("Only GET and POST are allowed.");
    }

    const body = request.body ?? null;
    if (body !== null && Buffer.byteLength(body, "utf8") > limits.maxRequestBytes) {
      throw new NetworkDeniedError("Request body is too large.");
    }

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers ?? {})) {
      const name = key.toLowerCase();
      if (!ALLOWED_REQUEST_HEADERS.has(name)) continue;
      headers[name] = value;
    }

    return transport.request({
      url: url.toString(),
      method,
      headers,
      body,
      timeoutMs: limits.timeoutMs,
      maxBytes: limits.maxResponseBytes,
    });
  };
}
