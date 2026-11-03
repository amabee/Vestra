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
  input: InstallCandidate | string,
  transport: GuardedTransport,
  providerReview: (url: string, document: unknown) => Promise<RemoteSourcePlan>,
): Promise<ExtensionReview> {
  const url = secureSourceUrl.parse(
    typeof input === "string" ? input : input.manifestURI,
  );
  const response = await transport.request({
    url,
    method: "GET",
    headers: { Accept: "application/json" },
    body: null,
    timeoutMs: 20000,
    maxBytes: 2 * 1048576,
  });
  if (response.status !== 200)
    throw new Error(`The extension manifest returned HTTP ${response.status}.`);
  if (Buffer.byteLength(response.body, "utf8") > 2 * 1048576)
    throw new Error("The extension manifest exceeds 2 MiB.");
  let document: Record<string, unknown>;
  try {
    document = JSON.parse(response.body);
  } catch {
    throw new Error("The extension manifest is not valid JSON.");
  }
  if (!document || Array.isArray(document) || typeof document !== "object")
    throw new Error("The extension manifest must be a JSON object.");
  let candidate: InstallCandidate;
  if (typeof input === "string") {
    if (
      typeof document.id !== "string" ||
      !/^[a-zA-Z0-9._-]{1,100}$/.test(document.id) ||
      typeof document.name !== "string" ||
      !document.name.trim() ||
      document.name.length > 120
    )
      throw new Error("The extension manifest needs a valid ID and name.");
    candidate = {
      id: document.id,
      name: document.name,
      version:
        typeof document.version === "string" ? document.version : "0.0.0",
      type:
        document.role === "manga-source" || document.type === "manga-provider"
          ? "manga-provider"
          : document.role === "stream-source" ||
              document.type === "onlinestream-provider"
            ? "onlinestream-provider"
            : "custom-source",
      manifestURI: url,
      payloadURI: "",
      registryUrl: "direct:manifest",
    };
  } else candidate = input;
  assertLoadable(candidate.id, candidate.type);
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
