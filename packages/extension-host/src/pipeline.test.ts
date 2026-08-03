import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MemoryDriver } from "@vestra/storage";
import { describe, expect, it } from "vitest";

import { parseSearchResults, parseDetails, isSdkCompatible } from "./contract";
import {
  checkDrift,
  completeInstall,
  InstallError,
  prepareInstall,
  type InstallCandidate,
} from "./install";
import { parseManifest } from "./manifest";
import type { GuardedTransport } from "./net";
import { createBrokeredFetch, NetworkDeniedError } from "./net";
import { createHostBridge } from "./bridge";
import type { PermissionGrant } from "./permissions";
import { listInstalled, readSource, removeInstalled, saveInstalled } from "./store";
import { ExtensionRefusedError } from "./trust";

/**
 * The install pipeline, exercised without a network.
 *
 * A stub transport stands in for the guarded fetch, which is what makes the
 * whole path testable: policy lives in this package, transport lives in the
 * app, and the seam between them is an interface.
 */

const EXAMPLE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../examples/open-library",
);

async function exampleFiles() {
  const [manifest, source] = await Promise.all([
    readFile(path.join(EXAMPLE_DIR, "manifest.json"), "utf8"),
    readFile(path.join(EXAMPLE_DIR, "index.js"), "utf8"),
  ]);
  return { manifest, source };
}

/** Serves fixed bodies per URL and records what was requested. */
function stubTransport(routes: Record<string, string>): GuardedTransport & {
  requested: string[];
} {
  const requested: string[] = [];

  return {
    requested,
    request: async ({ url }): Promise<{
      status: number;
      headers: Record<string, string>;
      body: string;
    }> => {
      requested.push(url);
      const body = routes[url];
      if (body === undefined) return { status: 404, headers: {}, body: "" };
      return { status: 200, headers: { "content-type": "application/json" }, body };
    },
  };
}

const MANIFEST_URL = "https://example.test/manifest.json";
const PAYLOAD_URL = "https://example.test/index.js";

function candidate(overrides: Partial<InstallCandidate> = {}): InstallCandidate {
  return {
    id: "example-open-library",
    name: "Open Library Example",
    version: "1.0.0",
    type: "custom-source",
    manifestURI: MANIFEST_URL,
    payloadURI: PAYLOAD_URL,
    registryUrl: "https://example.test/registry.json",
    ...overrides,
  };
}

describe("the reference extension", () => {
  it("ships a manifest that satisfies the contract", async () => {
    const { manifest } = await exampleFiles();
    const { manifest: parsed, errors } = parseManifest(JSON.parse(manifest));

    expect(errors).toEqual([]);
    expect(parsed?.id).toBe("example-open-library");
    // Declares network AND the hosts it will reach — one without the other is refused.
    expect(parsed?.permissions).toContain("network");
    expect(parsed?.hosts).toEqual(["openlibrary.org"]);
  });
});

describe("manifest validation", () => {
  it("refuses network permission without declared hosts", () => {
    const { errors } = parseManifest({
      id: "a",
      name: "A",
      version: "1.0.0",
      main: "index.js",
      sdkVersion: "1.0.0",
      permissions: ["network"],
      hosts: [],
    });

    expect(errors.join()).toMatch(/declares no hosts/);
  });

  it("refuses an entry point that climbs out of the extension", () => {
    const { errors } = parseManifest({
      id: "a",
      name: "A",
      version: "1.0.0",
      main: "../../../etc/passwd",
      sdkVersion: "1.0.0",
    });

    expect(errors.join()).toMatch(/relative path inside/);
  });
});

describe("install", () => {
  it("refuses excluded types before making any request", async () => {
    const transport = stubTransport({});

    await expect(
      prepareInstall(candidate({ type: "onlinestream-provider" }), transport),
    ).rejects.toBeInstanceOf(ExtensionRefusedError);

    // The important part: nothing was fetched. Declining while still pinging
    // the host is not declining.
    expect(transport.requested).toEqual([]);
  });

  it("refuses a manifest claiming a different identity", async () => {
    const { manifest } = await exampleFiles();
    const transport = stubTransport({ [MANIFEST_URL]: manifest });

    await expect(
      prepareInstall(candidate({ id: "something-else" }), transport),
    ).rejects.toThrow(/identifies itself as/);
  });

  it("warns that a branch payload can change after install", async () => {
    const { manifest } = await exampleFiles();
    const transport = stubTransport({ [MANIFEST_URL]: manifest });

    const plan = await prepareInstall(candidate(), transport);

    expect(plan.pinned).toBe(false);
    expect(plan.warnings.join()).toMatch(/served from a branch/);
    // Phase one reads the manifest only — the code is not downloaded yet.
    expect(transport.requested).toEqual([MANIFEST_URL]);
  });

  it("recognises a pinned release asset", async () => {
    const { manifest } = await exampleFiles();
    const pinnedUrl = "https://example.test/releases/download/v1.0.0/index.js";
    const transport = stubTransport({ [MANIFEST_URL]: manifest });

    const plan = await prepareInstall(
      candidate({ payloadURI: pinnedUrl }),
      transport,
    );

    expect(plan.pinned).toBe(true);
  });

  it("cannot grant a permission the extension never requested", async () => {
    const { manifest, source } = await exampleFiles();
    const transport = stubTransport({
      [MANIFEST_URL]: manifest,
      [PAYLOAD_URL]: source,
    });

    const plan = await prepareInstall(candidate(), transport);

    await expect(
      completeInstall(plan, ["network", "library:read"], transport),
    ).rejects.toBeInstanceOf(InstallError);
  });

  it("records a narrower grant than was requested", async () => {
    const { manifest, source } = await exampleFiles();
    const transport = stubTransport({
      [MANIFEST_URL]: manifest,
      [PAYLOAD_URL]: source,
    });

    const plan = await prepareInstall(candidate(), transport);
    const { record } = await completeInstall(plan, [], transport);

    expect(record.grant.granted).toEqual([]);
    // Hosts are meaningless without network, so they are not carried over.
    expect(record.grant.allowedHosts).toEqual([]);
  });

  it("fingerprints exactly what it downloaded", async () => {
    const { manifest, source } = await exampleFiles();
    const transport = stubTransport({
      [MANIFEST_URL]: manifest,
      [PAYLOAD_URL]: source,
    });

    const plan = await prepareInstall(candidate(), transport);
    const { record } = await completeInstall(plan, ["network"], transport);

    expect(record.integrity).toBe(createHash("sha256").update(source, "utf8").digest("hex"));
    expect(record.grant.allowedHosts).toEqual(["openlibrary.org"]);
  });
});

describe("drift detection", () => {
  it("notices when a mutable payload changes under it", async () => {
    const { manifest, source } = await exampleFiles();
    const transport = stubTransport({
      [MANIFEST_URL]: manifest,
      [PAYLOAD_URL]: source,
    });

    const plan = await prepareInstall(candidate(), transport);
    const { record } = await completeInstall(plan, ["network"], transport);

    expect((await checkDrift(record, transport)).status).toBe("unchanged");

    // The whole point of hashing at install: the URL is the same, the code is not.
    const tampered = stubTransport({
      [PAYLOAD_URL]: `${source}\n/* injected later */`,
    });

    const drift = await checkDrift(record, tampered);
    expect(drift.status).toBe("changed");
    expect(drift.currentIntegrity).not.toBe(record.integrity);
  });
});

describe("store", () => {
  it("round-trips a record and its code", async () => {
    const driver = new MemoryDriver();
    const { manifest, source } = await exampleFiles();
    const transport = stubTransport({
      [MANIFEST_URL]: manifest,
      [PAYLOAD_URL]: source,
    });

    const plan = await prepareInstall(candidate(), transport);
    const { record } = await completeInstall(plan, ["network"], transport);

    await saveInstalled(driver, record, source);

    expect((await listInstalled(driver)).map((r) => r.id)).toEqual([record.id]);
    expect(await readSource(driver, record)).toBe(source);

    await removeInstalled(driver, record.id);
    expect(await listInstalled(driver)).toEqual([]);
  });

  it("refuses to store code that does not match its fingerprint", async () => {
    const driver = new MemoryDriver();
    const { manifest, source } = await exampleFiles();
    const transport = stubTransport({
      [MANIFEST_URL]: manifest,
      [PAYLOAD_URL]: source,
    });

    const plan = await prepareInstall(candidate(), transport);
    const { record } = await completeInstall(plan, ["network"], transport);

    await expect(saveInstalled(driver, record, "different code")).rejects.toThrow(
      /does not match its fingerprint/,
    );
  });

  it("will not return code that was tampered with on disk", async () => {
    const driver = new MemoryDriver();
    const { manifest, source } = await exampleFiles();
    const transport = stubTransport({
      [MANIFEST_URL]: manifest,
      [PAYLOAD_URL]: source,
    });

    const plan = await prepareInstall(candidate(), transport);
    const { record } = await completeInstall(plan, ["network"], transport);
    await saveInstalled(driver, record, source);

    // Simulate something rewriting the stored file after install.
    await driver.write(`ext-src-${record.integrity.slice(0, 48)}`, {
      source: "malicious()",
    });

    expect(await readSource(driver, record)).toBeNull();
  });
});

describe("the network broker", () => {
  const grant: PermissionGrant = {
    extensionId: "e",
    granted: ["network"],
    allowedHosts: ["openlibrary.org"],
    grantedForVersion: "1.0.0",
    grantedAt: new Date().toISOString(),
  };

  const transport = stubTransport({});

  it("allows a declared host", async () => {
    const fetcher = createBrokeredFetch(grant, transport);
    await expect(
      fetcher?.({ url: "https://openlibrary.org/search.json" }),
    ).resolves.toBeDefined();
  });

  it("refuses an undeclared host", async () => {
    const fetcher = createBrokeredFetch(grant, transport);
    await expect(fetcher?.({ url: "https://evil.test/collect" })).rejects.toBeInstanceOf(
      NetworkDeniedError,
    );
  });

  it("refuses a subdomain of a declared host", async () => {
    const fetcher = createBrokeredFetch(grant, transport);
    await expect(
      fetcher?.({ url: "https://sub.openlibrary.org/x" }),
    ).rejects.toBeInstanceOf(NetworkDeniedError);
  });

  it("refuses to downgrade to http", async () => {
    const fetcher = createBrokeredFetch(grant, transport);
    await expect(fetcher?.({ url: "http://openlibrary.org/x" })).rejects.toBeInstanceOf(
      NetworkDeniedError,
    );
  });

  it("strips headers that could attach credentials", async () => {
    const spy = stubTransport({});
    const calls: Record<string, string>[] = [];
    const wrapped: GuardedTransport = {
      request: async (input) => {
        calls.push(input.headers);
        return spy.request(input);
      },
    };

    const fetcher = createBrokeredFetch(grant, wrapped);
    await fetcher?.({
      url: "https://openlibrary.org/x",
      headers: { cookie: "session=1", authorization: "Bearer x", accept: "application/json" },
    });

    expect(calls[0]).toEqual({ accept: "application/json" });
  });
});

describe("the host bridge", () => {
  const deps = {
    transport: stubTransport({}),
    readLibrary: async () => ["a"],
    readProgress: async () => ({}),
    log: () => undefined,
  };

  it("omits capabilities that were not granted", () => {
    const bridge = createHostBridge(
      {
        extensionId: "e",
        granted: [],
        allowedHosts: [],
        grantedForVersion: "1.0.0",
        grantedAt: new Date().toISOString(),
      },
      deps,
    );

    // Absent, not present-and-throwing: a forgotten check cannot escalate.
    expect(bridge.fetch).toBeUndefined();
    expect(bridge.readLibrary).toBeUndefined();
    expect(bridge.readProgress).toBeUndefined();
    expect(typeof bridge.log).toBe("function");
  });

  it("attaches only what was granted", () => {
    const bridge = createHostBridge(
      {
        extensionId: "e",
        granted: ["library:read"],
        allowedHosts: [],
        grantedForVersion: "1.0.0",
        grantedAt: new Date().toISOString(),
      },
      deps,
    );

    expect(bridge.readLibrary).toBeDefined();
    expect(bridge.fetch).toBeUndefined();
    expect(bridge.readProgress).toBeUndefined();
  });
});

describe("result validation", () => {
  it("drops bad entries without failing the whole call", () => {
    const { value, errors } = parseSearchResults([
      { id: "1", title: "Good" },
      { id: "2", title: "Bad poster", poster: "javascript:alert(1)" },
      { id: "3", title: "Also good" },
    ]);

    expect(value?.map((item) => item.id)).toEqual(["1", "3"]);
    expect(errors).toHaveLength(1);
  });

  it("refuses a non-array result outright", () => {
    expect(parseSearchResults({ not: "an array" }).value).toBeNull();
  });

  it("caps how much an extension can return", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ id: String(i), title: `T${i}` }));
    expect(parseSearchResults(many).value).toHaveLength(50);
  });

  it("rejects an http poster", () => {
    const { errors } = parseSearchResults([
      { id: "1", title: "T", poster: "http://insecure.test/a.jpg" },
    ]);
    expect(errors.join()).toMatch(/https/);
  });

  it("treats a null detail as absent rather than invalid", () => {
    expect(parseDetails(null)).toEqual({ value: null, errors: [] });
  });
});

describe("sdk compatibility", () => {
  it("accepts a matching major", () => {
    expect(isSdkCompatible("1.4.0", "1.0.0")).toBe(true);
  });

  it("refuses a different major", () => {
    expect(isSdkCompatible("2.0.0", "1.0.0")).toBe(false);
  });
});
