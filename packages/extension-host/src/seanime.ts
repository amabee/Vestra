import {
  EXTENSION_TYPES,
  EXTENSION_TYPE_SUPPORT,
  SUPPORTED_EXTENSION_TYPES,
  type ExtensionType,
} from "@vestra/provider-sdk";
import { z } from "zod";

import { EXTENSION_SDK_VERSION } from "./contract";
import { parseManifest, type ValidatedManifest } from "./manifest";

/**
 * Reading a Seanime extension manifest as if it were one of ours.
 *
 * This translates a manifest. It does not adopt a runtime, and it never runs
 * Seanime's code the way Seanime would. Their plugins reach into the host's
 * DOM — their own manifest calls that `dom-script-manipulation` — and anything
 * carrying that flag is refused here rather than accommodated, because the
 * capability that makes those plugins useful is the same one that would hand a
 * guest the whole preload bridge.
 *
 * What survives translation is the narrow, honest part: a metadata source that
 * fetches JSON over https and returns search results.
 *
 * The translation is deliberately loud. Every assumption lands in `notes` and
 * every refusal in `blockers`, because the failure mode to avoid is an
 * extension that installs cleanly and then quietly does nothing.
 */

/* =============================================================================
 * Their manifest
 * ========================================================================== */

/**
 * Parsed permissively on purpose.
 *
 * This is a foreign format we do not control, read from files written for a
 * different application. Rejecting on a field we happen not to recognise would
 * turn "we cannot translate this" into "this is corrupt", which is a different
 * and less useful thing to tell someone. Everything defaults, and the checks
 * that matter run afterwards where they can explain themselves.
 */
const unsafeFlagSchema = z.object({
  flag: z.string().default(""),
  reason: z.string().default(""),
});

const networkAccessSchema = z.object({
  allowedDomains: z.array(z.string()).default([]),
  reasoning: z.string().default(""),
});

const allowlistSchema = z.object({
  networkAccess: networkAccessSchema.prefault({}),
  unsafeFlags: z.array(unsafeFlagSchema).default([]),
  readPaths: z.array(z.string()).default([]),
  writePaths: z.array(z.string()).default([]),
  commandScopes: z.array(z.unknown()).default([]),
});

const pluginManifestSchema = z.object({
  version: z.string().default(""),
  permissions: z
    .object({
      scopes: z.array(z.string()).default([]),
      allow: allowlistSchema.prefault({}),
    })
    .prefault({}),
});

export const seanimeManifestSchema = z.object({
  id: z.string().default(""),
  name: z.string().default(""),
  version: z.string().default(""),
  manifestURI: z.string().default(""),
  /** "javascript" | "typescript" | "go" */
  language: z.string().default(""),
  type: z.string().default(""),
  description: z.string().default(""),
  author: z.string().default(""),
  icon: z.string().default(""),
  website: z.string().default(""),
  lang: z.string().default(""),
  /** Code inlined into the manifest. Seanime allows this instead of a URI. */
  payload: z.string().default(""),
  payloadURI: z.string().default(""),
  plugin: pluginManifestSchema.optional(),
});

export type SeanimeManifest = z.infer<typeof seanimeManifestSchema>;

/** The plugin manifest revision Seanime itself accepts. */
const SUPPORTED_PLUGIN_MANIFEST_VERSION = "1";

/**
 * Seanime plugin scopes, and what Vestra could honour.
 *
 * Every one of these is currently unmappable, and that is the finding rather
 * than an omission. Vestra grants three things — network, library reads,
 * progress reads — and none of Seanime's scopes narrow to them: `anilist` is a
 * client with the user's token behind it, `system` is the filesystem,
 * `torrent-client` drives downloads. Mapping any of them onto a Vestra
 * permission would be inventing consent the user never gave.
 *
 * Listed explicitly rather than caught by a fallback so that a scope Seanime
 * adds later shows up as unknown instead of silently passing.
 */
const KNOWN_PLUGIN_SCOPES = [
  "storage",
  "database",
  "playback",
  "debrid",
  "anilist",
  "anilist-token",
  "custom-client",
  "system",
  "cron",
  "notification",
  "discord",
  "torrent-client",
  "auth",
  "extensions",
  "settings",
] as const;

/* =============================================================================
 * The result
 * ========================================================================== */

export interface SeanimeTranslation {
  /** Vestra manifest, or null when `blockers` is non-empty. */
  manifest: ValidatedManifest | null;
  /** Code carried inline in the manifest, if any. */
  payload: string | null;
  /** Why this cannot be installed. Non-empty means `manifest` is null. */
  blockers: string[];
  /** Assumptions made, and anything dropped in translation. */
  notes: string[];
  /** Type as declared, when recognised at all. */
  type: ExtensionType | null;
  /** Hosts proposed from the payload rather than declared by the author. */
  hostsInferred: boolean;
}

/* =============================================================================
 * Host discovery
 * ========================================================================== */

/**
 * Matches an https origin written as a literal.
 *
 * Requires a dotted name with an alphabetic TLD, which is what keeps
 * `https://localhost` and bare IPv4 out of the proposals — both are refused
 * downstream anyway, so offering them would only be noise in a consent prompt.
 */
const HTTPS_LITERAL = /https:\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63})/gi;

/** The manifest schema caps `hosts`, and a longer list is unreadable anyway. */
const MAX_PROPOSED_HOSTS = 20;

/**
 * Read the hosts an extension appears to contact out of its own source.
 *
 * Seanime's `custom-source` manifests carry no host allowlist — their
 * top-level `permissions` field is marked NOT IMPLEMENTED in their own code,
 * and `networkAccess` exists only for plugins. Vestra will not grant network
 * access without naming the hosts, so the names have to come from somewhere,
 * and the only remaining source is the code.
 *
 * This is a heuristic and is safe precisely because it is only a proposal. The
 * broker enforces the granted list at request time, so a host this misses —
 * built by concatenation, say, or fetched from a config — is not a hole. The
 * extension simply cannot reach it, and fails visibly. Under-reading costs
 * function; it never costs containment.
 */
export function proposeHosts(source: string): string[] {
  const found = new Set<string>();

  for (const match of source.matchAll(HTTPS_LITERAL)) {
    const host = match[1]?.toLowerCase();
    if (host !== undefined && host.length <= 253) found.add(host);
  }

  return [...found].sort().slice(0, MAX_PROPOSED_HOSTS);
}

/**
 * Normalise one of Seanime's `allowedDomains` patterns to a bare hostname.
 *
 * Their patterns permit a scheme and a leading wildcard; Vestra's host list is
 * exact names only. `*.example.com` therefore narrows to `example.com`, which
 * does NOT cover subdomains here — `hostAllowed` in net.ts is an exact match.
 * That is the direction to fail in: the extension may find a subdomain
 * unreachable, but no grant is wider than what was written down.
 */
function normaliseAllowedDomain(pattern: string): string | null {
  let host = pattern.trim().toLowerCase();
  if (host.length === 0) return null;

  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  host = host.replace(/^\*\./, "");
  // Drop anything after the authority, plus a port.
  host = host.split("/")[0] ?? "";
  host = host.split(":")[0] ?? "";

  return host.length > 0 ? host : null;
}

/* =============================================================================
 * Translation
 * ========================================================================== */

function isExtensionType(value: string): value is ExtensionType {
  return (EXTENSION_TYPES as readonly string[]).includes(value);
}

/**
 * Kind assumed for a translated source.
 *
 * Seanime's `custom-source` is an anime/manga tracker source, and manga is not
 * a kind Vestra has anywhere to put. `anime` is the honest reading, but it IS
 * an assumption, so it is announced in the notes rather than applied quietly —
 * an extension filed under a kind it never claimed returns results in the
 * wrong section, which reads as a broken app.
 */
const ASSUMED_KIND = "anime" as const;

export interface TranslateOptions {
  /**
   * The extension's code, when it has already been fetched.
   *
   * Needed to propose hosts. Vestra's own install fetches the manifest first
   * and the code only after consent; a Seanime manifest cannot describe its
   * own network reach, so the code has to be in hand before the user can be
   * asked. Downloading is not executing, and the bytes are still fingerprinted
   * before anything is stored.
   */
  payload?: string;
}

export function translateSeanimeManifest(
  raw: unknown,
  options: TranslateOptions = {},
): SeanimeTranslation {
  const blockers: string[] = [];
  const notes: string[] = [];

  const parsed = seanimeManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      manifest: null,
      payload: null,
      blockers: ["This is not a Seanime extension manifest."],
      notes: [],
      type: null,
      hostsInferred: false,
    };
  }

  const source = parsed.data;
  const payload = source.payload.length > 0 ? source.payload : (options.payload ?? null);

  /* --- identity ------------------------------------------------------------ */

  for (const [field, value] of [
    ["id", source.id],
    ["name", source.name],
    ["version", source.version],
  ] as const) {
    if (value.trim().length === 0) blockers.push(`The manifest has no ${field}.`);
  }

  // Refused rather than sanitised: the id keys storage and grants, so quietly
  // rewriting it would install the extension under a name it never claimed.
  if (source.id.length > 0 && !/^[a-zA-Z0-9._-]+$/.test(source.id)) {
    blockers.push(
      `The id "${source.id}" contains characters Vestra does not allow in an extension id.`,
    );
  }

  /* --- type ---------------------------------------------------------------- */

  const type = isExtensionType(source.type) ? source.type : null;

  if (type === null) {
    blockers.push(`Unrecognised extension type "${source.type}".`);
  } else if (!SUPPORTED_EXTENSION_TYPES.includes(type)) {
    blockers.push(EXTENSION_TYPE_SUPPORT[type].reason);
  }

  /* --- language ------------------------------------------------------------ */

  const language = source.language.toLowerCase();

  if (language === "go") {
    blockers.push(
      "Written in Go. Vestra's sandbox runs JavaScript, and compiling Go to run here would mean shipping a second runtime.",
    );
  } else if (language === "typescript") {
    blockers.push(
      "Ships TypeScript. Vestra installs the exact bytes it fingerprints, and compiling on the way in would mean the code that runs is not the code that was reviewed.",
    );
  } else if (language !== "javascript" && language.length > 0) {
    blockers.push(`Unrecognised language "${source.language}".`);
  }

  /* --- plugin surface ------------------------------------------------------ */

  if (source.plugin !== undefined) {
    const plugin = source.plugin;

    if (plugin.version !== SUPPORTED_PLUGIN_MANIFEST_VERSION) {
      blockers.push(
        `Plugin manifest version "${plugin.version}" is not one Seanime itself accepts.`,
      );
    }

    const unsafe = plugin.permissions.allow.unsafeFlags;
    if (unsafe.length > 0) {
      const described = unsafe
        .map((entry) => (entry.reason.length > 0 ? `${entry.flag} (${entry.reason})` : entry.flag))
        .join(", ");
      blockers.push(
        `Requires unsafe flags: ${described}. These let a plugin run code inside the host interface, which in Vestra would hand it the whole bridge and make every permission prompt decoration.`,
      );
    }

    const scopes = plugin.permissions.scopes;
    if (scopes.length > 0) {
      const known = scopes.filter((scope) =>
        (KNOWN_PLUGIN_SCOPES as readonly string[]).includes(scope),
      );
      const unknown = scopes.filter(
        (scope) => !(KNOWN_PLUGIN_SCOPES as readonly string[]).includes(scope),
      );

      if (known.length > 0) {
        blockers.push(
          `Asks for capabilities Vestra has no equivalent of: ${known.join(", ")}. Vestra grants network, library reads and progress reads; there is nothing to narrow these to.`,
        );
      }
      if (unknown.length > 0) {
        blockers.push(`Asks for unrecognised capabilities: ${unknown.join(", ")}.`);
      }
    }

    const { readPaths, writePaths } = plugin.permissions.allow;
    if (readPaths.length > 0 || writePaths.length > 0) {
      blockers.push(
        "Asks for filesystem paths. Extensions in Vestra have no filesystem access at all.",
      );
    }
  }

  /* --- network ------------------------------------------------------------- */

  const declaredDomains = source.plugin?.permissions.allow.networkAccess.allowedDomains ?? [];

  if (declaredDomains.includes("*")) {
    blockers.push(
      "Asks to reach any host. Vestra pins extensions to named hosts, and \"anywhere\" is not something a user can meaningfully agree to.",
    );
  }

  let hosts: string[] = [];
  let hostsInferred = false;

  if (declaredDomains.length > 0) {
    const normalised = declaredDomains
      .map(normaliseAllowedDomain)
      .filter((host): host is string => host !== null);

    hosts = [...new Set(normalised)].sort().slice(0, MAX_PROPOSED_HOSTS);

    if (declaredDomains.some((pattern) => pattern.trim().startsWith("*."))) {
      notes.push(
        "Wildcard domains were narrowed to the bare name. Vestra matches hosts exactly, so subdomains are not covered and the extension may need them added by hand.",
      );
    }
  } else if (payload !== null) {
    hosts = proposeHosts(payload);
    hostsInferred = hosts.length > 0;

    if (hostsInferred) {
      notes.push(
        `The manifest declares no hosts, so these were read out of the code: ${hosts.join(", ")}. Confirm them — a host built at runtime will not appear here, and the extension will fail to reach it.`,
      );
    }
  } else {
    notes.push(
      "No code was supplied, so no hosts could be worked out. Translating again with the payload will propose them.",
    );
  }

  /* --- assemble ------------------------------------------------------------ */

  if (blockers.length > 0) {
    return { manifest: null, payload, blockers, notes, type, hostsInferred };
  }

  if (source.description.length > 2000) {
    notes.push("The description was truncated to 2000 characters.");
  }

  if (source.website.length > 0 && !/^https?:\/\//i.test(source.website)) {
    notes.push(`Dropped an unusable website value: "${source.website}".`);
  }

  notes.push(
    `Filed under "${ASSUMED_KIND}" — Seanime does not record a Vestra content kind, so this was assumed.`,
  );
  notes.push(
    "Entry point set to index.js. Seanime manifests do not name one; Vestra stores the code under that name.",
  );
  // Said at translation time rather than discovered at first search. Seanime's
  // fetch performs anti-bot circumvention by default, so an extension written
  // there may assume it and appear simply broken here.
  notes.push(
    "Vestra does not circumvent anti-bot challenges. A site that challenges automated access will report that plainly instead of returning results.",
  );

  const candidate = {
    id: source.id,
    name: source.name,
    version: source.version,
    main: "index.js",
    sdkVersion: EXTENSION_SDK_VERSION,
    permissions: hosts.length > 0 ? ["network"] : [],
    hosts,
    kinds: [ASSUMED_KIND],
    ...(source.author.length > 0 ? { author: source.author.slice(0, 120) } : {}),
    ...(/^https?:\/\//i.test(source.website) ? { homepage: source.website } : {}),
    ...(source.description.length > 0
      ? { description: source.description.slice(0, 2000) }
      : {}),
  };

  const { manifest, errors } = parseManifest(candidate);

  if (manifest === null) {
    return {
      manifest: null,
      payload,
      blockers: errors.map((error) => `Translated manifest is not valid — ${error}`),
      notes,
      type,
      hostsInferred,
    };
  }

  if (hosts.length === 0) {
    notes.push(
      "Installed without network access, because no hosts could be established. A source that fetches anything will not work until they are.",
    );
  }

  return { manifest, payload, blockers: [], notes, type, hostsInferred };
}
