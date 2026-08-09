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
  /**
   * Accepted and inert.
   *
   * Other applications' fetch shims perform anti-bot circumvention by default
   * and expose this to opt out of it. Vestra never circumvents an access
   * control, so the flag is already satisfied however it is set — it exists
   * here so an extension written against that convention parses and behaves
   * identically, and so nobody later reads the missing field as a TODO.
   */
  noCloudflareBypass?: boolean;
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

/**
 * The site answered with an anti-bot challenge rather than content.
 *
 * Distinct from `NetworkDeniedError`, which means Vestra refused the request.
 * This means the far end refused it, and the difference matters to the user:
 * one is a permission they can change, the other is a site that does not want
 * automated access.
 *
 * Raised rather than returned so a challenge page can never be parsed as
 * content. A scraper handed a 403 body full of JavaScript will happily match
 * zero results and report an empty catalogue, which is indistinguishable from
 * a broken extension — the failure this class exists to make legible.
 *
 * Vestra does not solve these. Doing so means impersonating a browser to
 * defeat a control the site deliberately deployed; a site that challenges us
 * is a site telling us not to, and the honest response is to say so.
 */
export class SourceChallengedError extends Error {
  readonly hostname: string;

  constructor(hostname: string) {
    super(
      `${hostname} is challenging automated access, so this source cannot be read.`,
    );
    this.name = "SourceChallengedError";
    this.hostname = hostname;
  }
}

/** Only the head of the body is scanned — challenge markers are in the first tag. */
const CHALLENGE_SCAN_BYTES = 4096;

/**
 * Body markers, checked only alongside a challenge status and a matching
 * server header. On their own these strings appear in ordinary pages that
 * merely discuss Cloudflare, so they are corroboration rather than evidence.
 */
const CHALLENGE_BODY_MARKERS = [
  "cf-browser-verification",
  "challenge-platform",
  "__cf_chl",
  "cf_chl_opt",
  "just a moment",
];

/**
 * Whether a response is a challenge rather than content.
 *
 * `cf-mitigated: challenge` is Cloudflare's own signal and is trusted alone.
 * Everything else needs the status, the server header and a body marker to
 * agree, because a bare 403 is ordinary and misreporting it as a challenge
 * would send the user looking for the wrong problem.
 */
export function isChallengeResponse(response: {
  status: number;
  headers: Record<string, string>;
  body: string;
}): boolean {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(response.headers)) {
    headers[key.toLowerCase()] = value.toLowerCase();
  }

  if (headers["cf-mitigated"] === "challenge") return true;

  if (response.status !== 403 && response.status !== 503) return false;

  const server = headers["server"] ?? "";
  const challengeIssuer =
    server.includes("cloudflare") ||
    server.includes("ddos-guard") ||
    "cf-ray" in headers;

  if (!challengeIssuer) return false;

  const head = response.body.slice(0, CHALLENGE_SCAN_BYTES).toLowerCase();
  return CHALLENGE_BODY_MARKERS.some((marker) => head.includes(marker));
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

    const response = await transport.request({
      url: url.toString(),
      method,
      headers,
      body,
      timeoutMs: limits.timeoutMs,
      maxBytes: limits.maxResponseBytes,
    });

    // Checked here rather than left to the extension: every extension would
    // otherwise have to recognise a challenge page itself, and the ones that
    // forgot would report "no results" for a site that is simply refusing us.
    if (isChallengeResponse(response)) {
      throw new SourceChallengedError(url.hostname);
    }

    return response;
  };
}
