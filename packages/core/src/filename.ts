/**
 * Re-export shim.
 *
 * The parser moved to `@vestra/providers` because the library scanner needs it
 * and `core` depends on `providers`, not the other way round. Existing
 * `@vestra/core/filename` imports keep working.
 */
export {
  isVideoFile,
  normaliseTitle,
  parseMediaFilename,
  type ParsedFilename,
} from "@vestra/providers/filename";
