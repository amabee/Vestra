import {
  EXTENSION_TYPE_SUPPORT,
  type ExtensionType,
  SUPPORTED_EXTENSION_TYPES,
} from "@vestra/provider-sdk";

/**
 * The two tiers, and what separates them.
 *
 * Vestra runs code from two places, and they are not variations of the same
 * thing:
 *
 *   trusted    First-party code that lives in this repository. Reviewed,
 *              compiled into the build, shipped by the project. It gets full
 *              network and filesystem access because it *is* the application —
 *              sandboxing it would cost performance and buy nothing, since the
 *              sandbox and the code inside it would ship together.
 *
 *   community  Third-party code fetched from a registry at runtime. Nobody
 *              here has read it, it can change between one launch and the
 *              next, and it arrives with the user's library and network within
 *              reach. It gets an isolate, a deny-by-default surface, and only
 *              the permissions the user granted.
 *
 * The distinction is PROVENANCE, not behaviour. A trusted provider is not
 * trusted because of what it does; it is trusted because it is in the repo and
 * the project is answerable for it. That is also why the trusted tier is
 * closed: there is no mechanism to load into it, and adding one would collapse
 * the two tiers into a single unguarded one.
 */
export type ProviderTier = "trusted" | "community";

export interface TierPolicy {
  /** Unmediated access to the network stack. */
  ambientNetwork: boolean;
  /** Unmediated access to the filesystem. */
  ambientFilesystem: boolean;
  /** Runs inside an isolate with a brokered host surface. */
  isolated: boolean;
  /** Every host call is checked against a user-granted permission set. */
  permissioned: boolean;
  /** Can be added, updated or removed after the build ships. */
  loadableAtRuntime: boolean;
}

export const TIER_POLICY: Record<ProviderTier, TierPolicy> = {
  trusted: {
    ambientNetwork: true,
    ambientFilesystem: true,
    isolated: false,
    permissioned: false,
    loadableAtRuntime: false,
  },
  community: {
    ambientNetwork: false,
    ambientFilesystem: false,
    isolated: true,
    permissioned: true,
    loadableAtRuntime: true,
  },
};

/**
 * Thrown when an extension is refused before it is ever loaded.
 *
 * Refusal happens here rather than in the UI. The marketplace page hides these
 * types, but a hidden control is a presentation detail and the loader is the
 * boundary that actually holds.
 */
export class ExtensionRefusedError extends Error {
  constructor(
    readonly extensionId: string,
    readonly reason: string,
  ) {
    super(`Refused to load "${extensionId}": ${reason}`);
    this.name = "ExtensionRefusedError";
  }
}

/**
 * Gate every load on the supported-type allowlist.
 *
 * Call this at the top of the loader, before fetching a payload — not only
 * before executing one. An extension that is never downloaded cannot be
 * accidentally executed by a later refactor.
 */
export function assertLoadable(extensionId: string, type: ExtensionType): void {
  if (SUPPORTED_EXTENSION_TYPES.includes(type)) return;

  throw new ExtensionRefusedError(extensionId, EXTENSION_TYPE_SUPPORT[type].reason);
}
