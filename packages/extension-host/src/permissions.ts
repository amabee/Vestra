import type { ExtensionPermission } from "@vestra/provider-sdk";

/**
 * What a community extension is allowed to ask the host for.
 *
 * Two rules shape this file:
 *
 *  1. Permissions are *capabilities*, not flags. An ungranted permission means
 *     the corresponding method is absent from the bridge, not present-and-
 *     guarded. Code cannot call what it cannot see, and a missing check stops
 *     being a vulnerability.
 *
 *  2. Grants are checked on every call, not once at install. Nothing else can
 *     be relied upon: a grant can be revoked while an extension is loaded.
 */

export interface PermissionDescriptor {
  permission: ExtensionPermission;
  /** Shown at the grant prompt. Written for a user, not a developer. */
  title: string;
  /** The honest worst case, not the intended use. */
  risk: string;
}

export const PERMISSION_DESCRIPTORS: Record<ExtensionPermission, PermissionDescriptor> = {
  network: {
    permission: "network",
    title: "Connect to the internet",
    risk: "Can send anything it can read to the hosts it declares. Requests are proxied by Vestra and limited to those hosts, but their contents are the extension's to choose.",
  },
  "library:read": {
    permission: "library:read",
    title: "Read your library index",
    risk: "Sees the titles, file paths and folder names of everything you have indexed. Combined with internet access, it can transmit that list.",
  },
  "progress:read": {
    permission: "progress:read",
    title: "Read your watch progress",
    risk: "Sees what you have watched and how far. Combined with internet access, it can transmit your viewing history.",
  },
};

/**
 * A user's decision about one extension.
 *
 * Stored, not derived: the manifest says what an extension *asks* for, and this
 * says what it was *given*. They are frequently not the same, and an update
 * that widens the request must not silently widen the grant.
 */
export interface PermissionGrant {
  extensionId: string;
  granted: readonly ExtensionPermission[];
  /**
   * Hosts the extension may reach, lowercase and without port.
   *
   * Meaningful only alongside `network`. Sourced from the manifest and
   * confirmed by the user, so an extension cannot widen its own reach by
   * requesting a different host at call time.
   */
  allowedHosts: readonly string[];
  /** Manifest version the grant was made against. */
  grantedForVersion: string;
  grantedAt: string;
}

export function can(
  grant: PermissionGrant | null,
  permission: ExtensionPermission,
): boolean {
  return grant?.granted.includes(permission) ?? false;
}

/**
 * Whether an update may reuse the existing grant.
 *
 * An extension that asked for `network` at install and asks for
 * `library:read` after an update is a different proposition, and the user has
 * not agreed to it. Re-prompt rather than carrying the grant forward.
 */
export function grantCoversRequest(
  grant: PermissionGrant,
  requested: readonly ExtensionPermission[],
  requestedHosts: readonly string[],
): boolean {
  const hasAllPermissions = requested.every((permission) =>
    grant.granted.includes(permission),
  );
  if (!hasAllPermissions) return false;

  const allowed = new Set(grant.allowedHosts);
  return requestedHosts.every((host) => allowed.has(host.toLowerCase()));
}

/** Permissions requested by a manifest that the user has not agreed to. */
export function missingPermissions(
  grant: PermissionGrant | null,
  requested: readonly ExtensionPermission[],
): ExtensionPermission[] {
  return requested.filter((permission) => !can(grant, permission));
}
