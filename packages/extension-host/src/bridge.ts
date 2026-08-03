import { can, type PermissionGrant } from "./permissions";
import { createBrokeredFetch, type GuardedTransport, type NetworkLimits } from "./net";
import type { HostBridge } from "./runtime/engine";

/**
 * Assembles the host surface for one extension.
 *
 * Capability-style: a method exists only if the grant allows it. The
 * alternative — attach everything, check inside each method — means one
 * forgotten check is a privilege escalation. Here a forgotten check is an
 * absent function, and the guest gets a TypeError.
 */

export interface BridgeDependencies {
  transport: GuardedTransport;
  /** Resolves the library index. Called only with `library:read`. */
  readLibrary: () => Promise<unknown>;
  /** Resolves stored progress. Called only with `progress:read`. */
  readProgress: () => Promise<unknown>;
  log: (
    extensionId: string,
    level: "debug" | "info" | "warn" | "error",
    message: string,
  ) => void;
  networkLimits?: NetworkLimits;
}

export function createHostBridge(
  grant: PermissionGrant,
  deps: BridgeDependencies,
): HostBridge {
  const bridge: HostBridge = {
    extensionId: grant.extensionId,
    // Logging carries no permission: it reveals nothing and makes a
    // misbehaving extension diagnosable.
    log: (level, message) =>
      deps.log(grant.extensionId, level, String(message).slice(0, 4000)),
  };

  const brokeredFetch = createBrokeredFetch(grant, deps.transport, deps.networkLimits);
  if (brokeredFetch) bridge.fetch = brokeredFetch;

  if (can(grant, "library:read")) {
    bridge.readLibrary = deps.readLibrary;
  }

  if (can(grant, "progress:read")) {
    bridge.readProgress = deps.readProgress;
  }

  return bridge;
}
