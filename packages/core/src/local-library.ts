/**
 * Re-export shim.
 *
 * The local-file normalisers moved to `@vestra/providers` because `core` now
 * depends on `providers`, and a provider cannot import from its consumer.
 * Existing `@vestra/core/local-library` imports keep working.
 */
export { localFileToMediaItem, recentlyAddedLocal } from "@vestra/providers/local-library";
