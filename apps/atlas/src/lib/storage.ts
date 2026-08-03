import "server-only";

import { getNodeDriver, type StorageDriver } from "@vestra/storage";

/**
 * The server-side storage driver.
 *
 * `server-only` makes importing this from a client component a build error,
 * which keeps filesystem access and the data directory out of the browser bundle.
 */
export function getDriver(): StorageDriver {
  return getNodeDriver();
}
