import { join } from "node:path";
import { marketplaceEntrySchema } from "@vestra/provider-sdk/marketplace";
import { prepareUnpacked } from "./extension-unpacked";

export const BUNDLED_REGISTRY = "vestra:bundled";
const SOURCES = [
  "moviebox",
  "kisskh",
  "internet-archive",
  "vixsrc",
  "streamflix",
  "vidlink",
  "desiflix",
] as const;
const experimental = new Set<string>(["streamflix", "vidlink"]);

/** Fixed shipped folders only; renderer-supplied paths are never resolved here. */
async function readBundled(root: string, id: string) {
  const name = SOURCES.find((name) => "vestra-" + name === id);
  if (!name) throw Error("Unknown bundled extension.");
  const plan = await prepareUnpacked(join(root, name));
  if (plan.manifest.id !== id)
    throw Error("Bundled extension identity mismatch.");
  if (experimental.has(name))
    plan.warnings.push(
      "Experimental port: upstream live checks currently fail. Installation does not imply playback availability. " +
        plan.manifest.description,
    );
  return plan;
}

export async function prepareBundled(root: string, id: string) {
  if (id === "vestra-streamflix")
    throw Error(
      "StreamFlix is not ready for installation: its playback endpoints are unavailable and the port is still under verification.",
    );
  return readBundled(root, id);
}

export async function listBundled(root: string) {
  const entries = [],
    errors = [];
  for (const name of SOURCES) {
    try {
      const plan = await readBundled(root, "vestra-" + name);
      const m = plan.manifest;
      entries.push({
        ...marketplaceEntrySchema.parse({
          id: m.id,
          name: m.name,
          version: m.version,
          author: m.author,
          description: m.description,
          icon: m.icon,
          website: m.homepage,
          type: "custom-source",
          language: "javascript",
          kinds: m.kinds,
          manifestURI: BUNDLED_REGISTRY + "/" + m.id + "/manifest.json",
          payloadURI: "",
          tags: [
            "vestra",
            "native",
            ...(experimental.has(name) ? ["experimental"] : []),
            ...(name === "streamflix" ? ["installation-blocked"] : []),
          ],
        }),
        registryUrl: BUNDLED_REGISTRY,
      });
    } catch {
      errors.push({
        registryUrl: BUNDLED_REGISTRY,
        message: `The bundled ${name} extension could not be read. Rebuild or update Nova.`,
      });
    }
  }
  return { entries, errors };
}
