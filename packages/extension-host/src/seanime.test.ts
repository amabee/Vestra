import { describe, expect, it } from "vitest";

import { parseManifest } from "./manifest";
import { proposeHosts, translateSeanimeManifest } from "./seanime";

/**
 * Translating Seanime manifests.
 *
 * The cases that matter are the refusals. A translator that is merely
 * permissive would install things Vestra has decided not to run, and it would
 * do it while showing the user a consent screen that looked normal.
 */

function seanime(overrides: Record<string, unknown> = {}) {
  return {
    id: "example-source",
    name: "Example Source",
    version: "1.0.0",
    manifestURI: "https://example.test/manifest.json",
    language: "javascript",
    type: "custom-source",
    description: "An example.",
    author: "Someone",
    lang: "en",
    payload: "",
    payloadURI: "https://example.test/index.js",
    ...overrides,
  };
}

const PAYLOAD = `
  async function search(query) {
    const res = await fetch("https://api.example.test/v1/search?q=" + query);
    const more = await fetch("https://cdn.example.test/images/x.json");
    return [];
  }
`;

describe("translating a source", () => {
  it("produces a manifest Vestra's own validator accepts", () => {
    const { manifest, blockers } = translateSeanimeManifest(seanime(), {
      payload: PAYLOAD,
    });

    expect(blockers).toEqual([]);
    expect(manifest).not.toBeNull();

    // Round-trip: whatever we synthesised has to survive the real schema.
    const { errors } = parseManifest(manifest);
    expect(errors).toEqual([]);
  });

  it("reads hosts out of the code, because the manifest has none", () => {
    const { manifest, hostsInferred, notes } = translateSeanimeManifest(seanime(), {
      payload: PAYLOAD,
    });

    expect(manifest?.hosts).toEqual(["api.example.test", "cdn.example.test"]);
    expect(manifest?.permissions).toEqual(["network"]);
    expect(hostsInferred).toBe(true);
    expect(notes.some((note) => note.includes("read out of the code"))).toBe(true);
  });

  it("prefers a payload inlined in the manifest", () => {
    const { manifest, payload } = translateSeanimeManifest(
      seanime({ payload: 'fetch("https://inline.example.test/a")' }),
      { payload: PAYLOAD },
    );

    expect(payload).toContain("inline.example.test");
    expect(manifest?.hosts).toEqual(["inline.example.test"]);
  });

  it("grants no network when no hosts could be established", () => {
    const { manifest, notes } = translateSeanimeManifest(seanime());

    expect(manifest?.permissions).toEqual([]);
    expect(manifest?.hosts).toEqual([]);
    expect(notes.some((note) => note.includes("No code was supplied"))).toBe(true);
  });

  it("says the content kind was assumed rather than declared", () => {
    const { manifest, notes } = translateSeanimeManifest(seanime(), { payload: PAYLOAD });

    expect(manifest?.kinds).toEqual(["anime"]);
    expect(notes.some((note) => note.includes("assumed"))).toBe(true);
  });
});

describe("refusals", () => {
  it("refuses the scraper provider types on product grounds", () => {
    for (const type of ["manga-provider", "onlinestream-provider", "anime-torrent-provider"]) {
      const { manifest, blockers } = translateSeanimeManifest(seanime({ type }), {
        payload: PAYLOAD,
      });

      expect(manifest).toBeNull();
      expect(blockers.join(" ")).toMatch(/licen|tracker|indexer/i);
    }
  });

  it("refuses anything carrying an unsafe flag, and quotes it", () => {
    const { manifest, blockers } = translateSeanimeManifest(
      seanime({
        type: "plugin",
        plugin: {
          version: "1",
          permissions: {
            allow: {
              unsafeFlags: [{ flag: "dom-script-manipulation", reason: "inject a widget" }],
            },
          },
        },
      }),
      { payload: PAYLOAD },
    );

    expect(manifest).toBeNull();
    expect(blockers.join(" ")).toContain("dom-script-manipulation");
    expect(blockers.join(" ")).toContain("inject a widget");
  });

  it("refuses capabilities that have no Vestra equivalent", () => {
    const { manifest, blockers } = translateSeanimeManifest(
      seanime({
        type: "plugin",
        plugin: { version: "1", permissions: { scopes: ["anilist-token", "system"] } },
      }),
      { payload: PAYLOAD },
    );

    expect(manifest).toBeNull();
    expect(blockers.join(" ")).toContain("anilist-token");
    expect(blockers.join(" ")).toContain("system");
  });

  it("refuses a request to reach any host", () => {
    const { manifest, blockers } = translateSeanimeManifest(
      seanime({
        type: "plugin",
        plugin: {
          version: "1",
          permissions: { allow: { networkAccess: { allowedDomains: ["*"] } } },
        },
      }),
      { payload: PAYLOAD },
    );

    expect(manifest).toBeNull();
    expect(blockers.join(" ")).toContain("any host");
  });

  it("refuses Go and TypeScript payloads for different reasons", () => {
    const go = translateSeanimeManifest(seanime({ language: "go" }), { payload: PAYLOAD });
    expect(go.blockers.join(" ")).toContain("Go");

    const ts = translateSeanimeManifest(seanime({ language: "typescript" }), {
      payload: PAYLOAD,
    });
    expect(ts.blockers.join(" ")).toContain("TypeScript");
  });

  it("refuses an id it would have to rewrite", () => {
    const { manifest, blockers } = translateSeanimeManifest(
      seanime({ id: "bad id/../escape" }),
      { payload: PAYLOAD },
    );

    expect(manifest).toBeNull();
    expect(blockers.join(" ")).toContain("characters Vestra does not allow");
  });

  it("refuses a plugin manifest version Seanime itself would reject", () => {
    const { blockers } = translateSeanimeManifest(
      seanime({ type: "plugin", plugin: { version: "2", permissions: {} } }),
      { payload: PAYLOAD },
    );

    expect(blockers.join(" ")).toContain("not one Seanime itself accepts");
  });

  it("rejects something that is not a manifest at all", () => {
    const { manifest, blockers } = translateSeanimeManifest("nope");

    expect(manifest).toBeNull();
    expect(blockers).toEqual(["This is not a Seanime extension manifest."]);
  });
});

describe("declared domains", () => {
  it("narrows a wildcard to the bare name and says so", () => {
    const { manifest, notes, hostsInferred } = translateSeanimeManifest(
      seanime({
        type: "custom-source",
        plugin: {
          version: "1",
          permissions: {
            allow: {
              networkAccess: { allowedDomains: ["*.example.test", "https://other.test/path"] },
            },
          },
        },
      }),
      { payload: PAYLOAD },
    );

    // Declared wins over inferred — the author said it, so we don't guess.
    expect(manifest?.hosts).toEqual(["example.test", "other.test"]);
    expect(hostsInferred).toBe(false);
    expect(notes.some((note) => note.includes("subdomains are not covered"))).toBe(true);
  });
});

describe("proposeHosts", () => {
  it("dedupes, lowercases and sorts", () => {
    expect(
      proposeHosts('a "https://B.example.test/x" b "https://a.example.test" c "https://b.example.test"'),
    ).toEqual(["a.example.test", "b.example.test"]);
  });

  it("ignores loopback and bare addresses, which are refused anyway", () => {
    expect(proposeHosts('fetch("https://localhost:8080/x"); fetch("https://127.0.0.1/y")')).toEqual(
      [],
    );
  });

  it("finds nothing in code that builds its URLs", () => {
    // The honest limit of the heuristic, asserted so nobody mistakes it for a guarantee.
    expect(proposeHosts('const host = "api" + ".example.test"; fetch(`https://${host}/x`)')).toEqual(
      [],
    );
  });

  it("caps the list", () => {
    const many = Array.from({ length: 40 }, (_, i) => `https://h${i}.example.test`).join(" ");
    expect(proposeHosts(many)).toHaveLength(20);
  });
});
