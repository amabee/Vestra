import { createHash } from "node:crypto";

import { isPinnedRef, type ExtensionType } from "@vestra/provider-sdk";

import { parseManifest, type ValidatedManifest } from "./manifest";
import type { GuardedTransport } from "./net";
import type { PermissionGrant } from "./permissions";
import { assertLoadable, ExtensionRefusedError } from "./trust";

/**
 * Fetching, verifying and pinning a community extension.
 *
 * Install is two phases with the user in between. Phase one fetches only the
 * manifest and reports what the extension is asking for; phase two runs after
 * consent and fetches the code. Nothing executes in either — that is the
 * runtime's job, and it deliberately cannot start until an isolate exists.
 *
 * The central idea is that identity is the CONTENT HASH, not the URL. Most
 * registry payloads are served from a mutable branch, so a URL says nothing
 * about what will come back tomorrow. Recording the SHA-256 of the exact bytes
 * installed turns "this could change silently" into "this changed, and here is
 * when we noticed".
 */

const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

export interface InstallCandidate {
  id: string;
  name: string;
  version: string;
  type: ExtensionType;
  manifestURI: string;
  payloadURI: string;
  /** Registry the candidate came from, recorded for provenance. */
  registryUrl: string;
}

/** What phase one found. Everything the consent prompt needs. */
export interface InstallPlan {
  candidate: InstallCandidate;
  manifest: ValidatedManifest;
  /** Permissions the manifest asks for. */
  requested: readonly ValidatedManifest["permissions"][number][];
  /** Hosts it declares it will contact. */
  hosts: readonly string[];
  /** Payload comes from an immutable ref. */
  pinned: boolean;
  /** Things the user should weigh before consenting. */
  warnings: string[];
}

export interface InstalledExtension {
  id: string;
  name: string;
  version: string;
  type: ExtensionType;
  manifest: ValidatedManifest;
  grant: PermissionGrant;
  /** SHA-256 of the exact payload bytes that were installed. */
  integrity: string;
  payloadBytes: number;
  manifestURI: string;
  payloadURI: string;
  pinned: boolean;
  registryUrl: string;
  installedAt: string;
  /** Last time the remote payload was confirmed to still match `integrity`. */
  lastVerifiedAt: string;
  /** Set when a later check found different bytes at the same URL. */
  driftDetectedAt: string | null;
}

export class InstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallError";
  }
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

async function fetchText(
  transport: GuardedTransport,
  url: string,
  maxBytes: number,
  what: string,
): Promise<string> {
  if (!url.startsWith("https://")) {
    throw new InstallError(`The ${what} must be served over https.`);
  }

  let response;
  try {
    response = await transport.request({
      url,
      method: "GET",
      headers: { accept: "*/*" },
      body: null,
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes,
    });
  } catch (error) {
    throw new InstallError(
      `Could not download the ${what}: ${error instanceof Error ? error.message : "request failed"}`,
    );
  }

  if (response.status !== 200) {
    throw new InstallError(`The ${what} returned status ${response.status}.`);
  }

  return response.body;
}

/**
 * Phase one — read the manifest, decide whether this is installable at all.
 *
 * `assertLoadable` runs first, before any network call. An extension whose
 * type Vestra refuses should not have its manifest fetched either: declining
 * quietly while still pinging the host is not declining.
 */
export async function prepareInstall(
  candidate: InstallCandidate,
  transport: GuardedTransport,
): Promise<InstallPlan> {
  assertLoadable(candidate.id, candidate.type);

  const raw = await fetchText(
    transport,
    candidate.manifestURI,
    MAX_MANIFEST_BYTES,
    "manifest",
  );

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    throw new InstallError("The manifest is not valid JSON.");
  }

  const { manifest, errors } = parseManifest(document);
  if (!manifest) {
    throw new InstallError(`The manifest is not valid:\n${errors.join("\n")}`);
  }

  // A manifest that claims a different id than the registry listing is either
  // broken or trying to install itself over something else.
  if (manifest.id !== candidate.id) {
    throw new InstallError(
      `The manifest identifies itself as "${manifest.id}" but the registry lists it as "${candidate.id}".`,
    );
  }

  const pinned = isPinnedRef(candidate.payloadURI);
  const warnings: string[] = [];

  if (!pinned) {
    warnings.push(
      "The code is served from a branch, so it can change after you install it. Vestra records a fingerprint and will tell you if it does.",
    );
  }

  if (manifest.version !== candidate.version) {
    warnings.push(
      `The registry lists version ${candidate.version} but the manifest says ${manifest.version}.`,
    );
  }

  if (manifest.permissions.length === 0) {
    warnings.push("Requests no permissions — it cannot reach the network or your library.");
  }

  return {
    candidate,
    manifest,
    requested: manifest.permissions,
    hosts: manifest.hosts,
    pinned,
    warnings,
  };
}

/**
 * Phase two — fetch the code and record what was installed.
 *
 * `granted` is what the USER agreed to, which may be narrower than what the
 * manifest asked for. It is stored as given; the bridge later attaches only
 * these capabilities.
 */
export async function completeInstall(
  plan: InstallPlan,
  granted: readonly ValidatedManifest["permissions"][number][],
  transport: GuardedTransport,
): Promise<{ record: InstalledExtension; source: string }> {
  // Re-assert: the plan may have been held across a user prompt, and this is
  // the last point before code lands on disk.
  assertLoadable(plan.candidate.id, plan.candidate.type);

  const unrequested = granted.filter(
    (permission) => !plan.manifest.permissions.includes(permission),
  );
  if (unrequested.length > 0) {
    throw new InstallError(
      `Cannot grant permissions the extension did not request: ${unrequested.join(", ")}.`,
    );
  }

  const source = await fetchText(
    transport,
    plan.candidate.payloadURI,
    MAX_PAYLOAD_BYTES,
    "extension code",
  );

  if (source.trim().length === 0) {
    throw new InstallError("The extension code is empty.");
  }

  const now = new Date().toISOString();

  const grant: PermissionGrant = {
    extensionId: plan.candidate.id,
    granted,
    // Hosts only mean anything with network access; drop them otherwise so a
    // later grant edit cannot silently re-enable reach.
    allowedHosts: granted.includes("network")
      ? plan.manifest.hosts.map((host) => host.toLowerCase())
      : [],
    grantedForVersion: plan.manifest.version,
    grantedAt: now,
  };

  const record: InstalledExtension = {
    id: plan.candidate.id,
    name: plan.candidate.name,
    version: plan.manifest.version,
    type: plan.candidate.type,
    manifest: plan.manifest,
    grant,
    integrity: sha256(source),
    payloadBytes: Buffer.byteLength(source, "utf8"),
    manifestURI: plan.candidate.manifestURI,
    payloadURI: plan.candidate.payloadURI,
    pinned: plan.pinned,
    registryUrl: plan.candidate.registryUrl,
    installedAt: now,
    lastVerifiedAt: now,
    driftDetectedAt: null,
  };

  return { record, source };
}

export type DriftStatus = "unchanged" | "changed" | "unreachable";

export interface DriftResult {
  status: DriftStatus;
  /** Hash found at the URL now, when reachable. */
  currentIntegrity: string | null;
}

/**
 * Re-fetch an installed extension and compare it against what was installed.
 *
 * This is the payoff for hashing at install time. A pinned payload should
 * never change, so drift there means the ref was not immutable after all. A
 * branch payload changing is expected — but expected is not the same as
 * acceptable to run without asking again.
 */
export async function checkDrift(
  record: InstalledExtension,
  transport: GuardedTransport,
): Promise<DriftResult> {
  let source: string;
  try {
    source = await fetchText(transport, record.payloadURI, MAX_PAYLOAD_BYTES, "extension code");
  } catch {
    return { status: "unreachable", currentIntegrity: null };
  }

  const currentIntegrity = sha256(source);

  return {
    status: currentIntegrity === record.integrity ? "unchanged" : "changed",
    currentIntegrity,
  };
}

export { ExtensionRefusedError };
