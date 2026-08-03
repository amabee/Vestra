/**
 * @vestra/core — shared business logic.
 *
 * Search aggregation, home composition, filename parsing and formatting.
 * Server-safe: the search/discover modules reach for provider credentials, so
 * import those from Server Components or route handlers only. `format` and
 * `filename` are pure and safe anywhere.
 */

export * from "./format";
export * from "./filename";
export * from "./local-library";
export * from "./search";
export * from "./discover";
export * from "./continue-watching";
