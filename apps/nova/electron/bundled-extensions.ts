import { join } from "node:path";
import { marketplaceEntrySchema } from "@vestra/provider-sdk/marketplace";
import { prepareUnpacked } from "./extension-unpacked";

export const BUNDLED_REGISTRY = "vestra:bundled";
const SOURCES = [
  "moviebox",
  "kisskh",
  "internet-archive",
  "vixsrc",
  "desiflix",
  "vidlink",
  "streamflix",
  "hentai2read",
  "hentaiera",
  "mangabuddy",
  "mangakatana",
  "mangahub",
  "asurascans",
  "atsumaru",
  "fanfox",
  "kuramanga",
  "lelmanga",
  "mangafreak",
  "ravenscans",
  "mangastash",
  "manganato",
  "komiku",
  "mynimekumanga",
  "mangaworldadult",
  "animesama",
  "taiyo",
  "xcomic",
  "mangaball",
  "mangadot",
  "mangafire",
  "animegg",
  "animeheaven",
  "animesaturnmirror",
  "animeunion",
  "animeunitymirror",
  "animetoast",
  "shonen",
  "anitube",
  "mynimeku",
  "donghuastream",
  "nontonanime",
  "animeav1",
  "hentaisaturn",
  "hentaiworld",
  "shiro",
  "aniworld",
  "animetvplus",
] as const;
const experimental = new Set<string>([
  "vidlink",
  "streamflix",
  "hentai2read",
  "ravenscans",
  "manganato",
  "mangaball",
  "mangadot",
  "animegg",
  "animetoast",
  "donghuastream",
  "animetvplus",
]);

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
          type:
            m.role === "manga-source"
              ? "manga-provider"
              : m.kinds.includes("anime") &&
                  !m.kinds.some((kind) => kind === "movie" || kind === "tv")
                ? "onlinestream-provider"
                : "custom-source",
          language: "javascript",
          kinds: m.role === "manga-source" ? ["manga"] : m.kinds,
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

export function bundledManifestPath(root: string, id: string): string | null {
  const name = SOURCES.find((name) => "vestra-" + name === id);
  return name ? join(root, name, "manifest.json") : null;
}
