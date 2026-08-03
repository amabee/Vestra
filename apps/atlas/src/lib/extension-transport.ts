import "server-only";

import type { GuardedTransport } from "@vestra/extension-host";

import { safeFetch } from "./safe-fetch";

/**
 * The transport community extensions reach the network through.
 *
 * `@vestra/extension-host` owns the policy — permission checks, host
 * allowlisting, rate and size limits — and delegates the request itself to
 * this. Keeping them apart means the SSRF guard is written once and applies to
 * registry fetches, extension installs and extension runtime calls alike,
 * instead of each growing its own half-remembered copy.
 */
export const guardedTransport: GuardedTransport = {
  request: (input) => safeFetch(input),
};
