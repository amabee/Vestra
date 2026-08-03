/**
 * @vestra/provider-sdk
 *
 * The contract between Vestra and its content sources. The UI and `@vestra/core`
 * depend only on this — never on a specific provider — so sources can be added,
 * disabled or eventually shipped as extensions without touching shared code.
 */

export * from "./types";
export * from "./registry";
export * from "./orchestrate";
export * from "./marketplace";
