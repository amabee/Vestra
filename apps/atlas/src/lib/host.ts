import "server-only";

import { getVestraHost } from "@vestra/config";
import { FULL_HOST, type HostCapabilities } from "@vestra/provider-sdk";

/**
 * What this Atlas process can do.
 *
 * Atlas ships one codebase for two hosts. Run as a website it is a catalogue;
 * spawned by Nova (`VESTRA_HOST=desktop`) it is the desktop app's backend and
 * may load extensions. Deciding this on the server means a browser cannot
 * reach a desktop-only route by guessing the URL.
 */
export function getHostCapabilities(): HostCapabilities {
  const desktop = getVestraHost() === "desktop";

  return {
    ...FULL_HOST,
    platform: desktop ? "desktop" : "web",
    extensions: desktop,
  };
}

export function extensionsEnabled(): boolean {
  return getHostCapabilities().extensions;
}
