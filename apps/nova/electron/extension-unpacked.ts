import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  assertLoadable,
  buildInstallRecord,
  InstallError,
  MAX_PAYLOAD_BYTES,
  parseManifest,
  type InstallPlan,
  type InstalledExtension,
  type ValidatedManifest,
} from "@vestra/extension-host";

/**
 * Installing an extension from a folder on disk.
 *
 * Writing an extension against a registry is unworkable: every change means a
 * commit, a push, and a wait for a CDN. And the guard on outbound fetches
 * refuses loopback by design, so a local dev server is not an option either —
 * correctly, but it does mean there is no network route in.
 *
 * Reading the folder directly sidesteps both, the same way browsers load an
 * unpacked extension. It skips only the transport; the manifest is validated,
 * the type is re-asserted, the permission prompt is the same one, and the code
 * is fingerprinted exactly as a downloaded payload would be.
 *
 * What it cannot do is promise the code will not change: a folder is mutable
 * by definition, so these are never marked pinned.
 */

const MANIFEST_FILE = "manifest.json";

/** Marks a record as having come from disk rather than a registry. */
export const LOCAL_REGISTRY = "local:unpacked";

export function isUnpacked(record: InstalledExtension): boolean {
  return record.registryUrl === LOCAL_REGISTRY;
}

/**
 * Resolve a file the manifest points at, refusing to leave the folder.
 *
 * `main` comes from a file the user did not write, and "../../.ssh/id_rsa" is
 * a perfectly ordinary-looking string until it is joined to a path.
 */
function resolveInside(folder: string, relative: string): string {
  const base = path.resolve(folder);
  const target = path.resolve(base, relative);

  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new InstallError(`"${relative}" is outside the extension folder.`);
  }

  return target;
}

async function readManifest(folder: string): Promise<ValidatedManifest> {
  const file = resolveInside(folder, MANIFEST_FILE);

  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new InstallError(`No ${MANIFEST_FILE} in that folder.`);
  }

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    throw new InstallError(`${MANIFEST_FILE} is not valid JSON.`);
  }

  const { manifest, errors } = parseManifest(document);
  if (!manifest) {
    throw new InstallError(`${MANIFEST_FILE} is not valid:\n${errors.join("\n")}`);
  }

  return manifest;
}

/**
 * Phase one, from a folder.
 *
 * Returns the same `InstallPlan` the registry path produces, so the consent
 * step is literally the same screen rather than a second one that could drift
 * from it.
 */
export async function prepareUnpacked(folder: string): Promise<InstallPlan> {
  const manifest = await readManifest(folder);

  // Type is not in Vestra's manifest — an unpacked extension is a plugin by
  // definition, and `assertLoadable` still has the final say.
  assertLoadable(manifest.id, "plugin");

  const payload = resolveInside(folder, manifest.main);

  let bytes: number;
  try {
    const stats = await stat(payload);
    if (!stats.isFile()) throw new Error("not a file");
    bytes = stats.size;
  } catch {
    throw new InstallError(`The manifest points at "${manifest.main}", which is not there.`);
  }

  if (bytes > MAX_PAYLOAD_BYTES) {
    throw new InstallError("The extension code is larger than allowed.");
  }

  const warnings = [
    "Loaded from a folder on this machine. The code can change on disk at any time, so Vestra records a fingerprint but cannot promise it will still match later.",
  ];

  if (manifest.permissions.length === 0) {
    warnings.push("Requests no permissions — it cannot reach the network or your library.");
  }

  if (manifest.kinds.length === 0) {
    warnings.push(
      "Declares no content kinds, so it will load but will not be offered as a search source.",
    );
  }

  return {
    candidate: {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      type: "plugin",
      manifestURI: resolveInside(folder, MANIFEST_FILE),
      payloadURI: payload,
      registryUrl: LOCAL_REGISTRY,
    },
    manifest,
    requested: manifest.permissions,
    hosts: manifest.hosts,
    // Never pinned. Pinning means the bytes cannot change behind a fixed
    // reference, and a folder is mutable by definition.
    pinned: false,
    warnings,
  };
}

/** Phase two, from a folder. Reads the code and builds the same record. */
export async function completeUnpacked(
  plan: InstallPlan,
  granted: readonly ValidatedManifest["permissions"][number][],
): Promise<{ record: InstalledExtension; source: string }> {
  let source: string;
  try {
    source = await readFile(plan.candidate.payloadURI, "utf8");
  } catch {
    throw new InstallError("Could not read the extension code.");
  }

  if (Buffer.byteLength(source, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new InstallError("The extension code is larger than allowed.");
  }

  return buildInstallRecord(plan, granted, source);
}
