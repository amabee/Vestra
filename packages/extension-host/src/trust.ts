import {
  EXTENSION_TYPE_SUPPORT,
  type ExtensionType,
  SUPPORTED_EXTENSION_TYPES,
} from "@vestra/provider-sdk";

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

export class ExtensionRefusedError extends Error {
  constructor(
    readonly extensionId: string,
    readonly reason: string,
  ) {
    super(`Refused to load "${extensionId}": ${reason}`);
    this.name = "ExtensionRefusedError";
  }
}

export function assertLoadable(extensionId: string, type: ExtensionType): void {
  if (
    SUPPORTED_EXTENSION_TYPES.includes(type) ||
    type === "onlinestream-provider"
  ) {
    return;
  }

  throw new ExtensionRefusedError(
    extensionId,
    EXTENSION_TYPE_SUPPORT[type].reason,
  );
}
