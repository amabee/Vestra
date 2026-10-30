import { assertLoadable } from "@vestra/extension-host/trust";
import {
  prepareInstall,
  type InstallCandidate,
} from "@vestra/extension-host/install";
import type { GuardedTransport } from "@vestra/extension-host/net";
import { secureSourceUrl } from "./source-manager";
import type { ExtensionReview } from "../shared/extensions";
import type { RemoteSourcePlan } from "../shared/sources";

/** Resolve the manifest before choosing its existing execution/installation format. */
export async function prepareExtensionReview(
  candidate: InstallCandidate,
  transport: GuardedTransport,
  providerReview: (url: string, document: unknown) => Promise<RemoteSourcePlan>,
): Promise<ExtensionReview> {
  assertLoadable(candidate.id, candidate.type);
  const url = secureSourceUrl.parse(candidate.manifestURI);
  const response = await transport.request({
    url,
    method: "GET",
    headers: { Accept: "application/json" },
    body: null,
    timeoutMs: 20000,
    maxBytes: 65536,
  });
  if (response.status !== 200)
    throw new Error(`The extension manifest returned HTTP ${response.status}.`);
  if (Buffer.byteLength(response.body, "utf8") > 65536)
    throw new Error("The extension manifest exceeds 64 KiB.");
  let document: Record<string, unknown>;
  try {
    document = JSON.parse(response.body);
  } catch {
    throw new Error("The extension manifest is not valid JSON.");
  }
  if (!document || Array.isArray(document) || typeof document !== "object")
    throw new Error("The extension manifest must be a JSON object.");
  if (document.id !== candidate.id)
    throw new Error(
      "The manifest identity does not match this registry listing.",
    );
  if (
    !document.sdkVersion &&
    (document.type === "onlinestream-provider" ||
      document.type === "manga-provider")
  ) {
    if (document.type !== candidate.type)
      throw new Error(
        "The manifest content type does not match this registry listing.",
      );
    return { kind: "provider", plan: await providerReview(url, document) };
  }
  if (!document.sdkVersion && document.type)
    throw new Error(
      `The ${String(document.type).slice(0, 80)} manifest is not a supported anime/manga provider or Vestra SDK extension.`,
    );
  return {
    kind: "sdk",
    plan: await prepareInstall(candidate, transport, document),
  };
}
