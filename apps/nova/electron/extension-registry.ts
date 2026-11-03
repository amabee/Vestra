import {
  FOUNDRY_REGISTRY_URL,
  LEGACY_VESTRA_REGISTRY_URL,
} from "@vestra/types";

/** Preserve saved origins while the former official registry follows Foundry. */
export function registryFetchUrl(registryUrl: string): string {
  return registryUrl === LEGACY_VESTRA_REGISTRY_URL
    ? FOUNDRY_REGISTRY_URL
    : registryUrl;
}
