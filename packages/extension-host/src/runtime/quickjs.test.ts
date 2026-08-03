import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseSearchResults } from "../contract";
import type { HostBridge } from "./engine";
import { createQuickJSRuntime, ExtensionExecutionError } from "./quickjs";

/**
 * The isolate, tested against real extension code.
 *
 * The escape probes matter most: they are the difference between "we wrote a
 * sandbox" and "the sandbox holds".
 */

const EXAMPLE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../examples/open-library/index.js",
);

const OPEN_LIBRARY_RESPONSE = JSON.stringify({
  docs: [
    { key: "/works/OL893415W", title: "Dune", first_publish_year: 1965, cover_i: 8231583 },
    { key: "/works/OL27448W", title: "Dune Messiah", first_publish_year: 1969 },
    { nope: true },
  ],
});

function bridge(overrides: Partial<HostBridge> = {}): HostBridge {
  return {
    extensionId: "test",
    log: () => undefined,
    fetch: async () => ({ status: 200, headers: {}, body: OPEN_LIBRARY_RESPONSE }),
    ...overrides,
  };
}

/** Loads a snippet as an extension and returns whatever `probe()` reports. */
async function probe(source: string, host: HostBridge = bridge()): Promise<unknown> {
  const runtime = createQuickJSRuntime();
  const loaded = await runtime.load({ extensionId: "probe", source, bridge: host });

  try {
    return await loaded.call("probe", [], AbortSignal.timeout(10_000));
  } finally {
    loaded.dispose();
  }
}

describe("running the reference extension", () => {
  it("activates and returns usable search results", async () => {
    const source = await readFile(EXAMPLE, "utf8");
    const runtime = createQuickJSRuntime();
    const loaded = await runtime.load({
      extensionId: "example-open-library",
      source,
      bridge: bridge(),
    });

    try {
      const raw = await loaded.call("search", ["dune", { limit: 5 }], AbortSignal.timeout(10_000));
      const { value, errors } = parseSearchResults(raw);

      expect(errors).toEqual([]);
      expect(value?.map((item) => item.title)).toEqual(["Dune", "Dune Messiah"]);
      expect(value?.[0]?.year).toBe(1965);
      expect(value?.[0]?.poster).toBe("https://covers.openlibrary.org/b/id/8231583-M.jpg");
      // The malformed third doc was dropped by the extension, not by us.
      expect(value).toHaveLength(2);
    } finally {
      loaded.dispose();
    }
  }, 30_000);

  it("refuses to activate when the network permission was declined", async () => {
    const source = await readFile(EXAMPLE, "utf8");
    const runtime = createQuickJSRuntime();

    // fetch omitted entirely, exactly as createHostBridge would leave it.
    const loaded = await runtime.load({
      extensionId: "example-open-library",
      source,
      bridge: { extensionId: "x", log: () => undefined },
    });

    try {
      await expect(
        loaded.call("search", ["dune", { limit: 5 }], AbortSignal.timeout(10_000)),
      ).rejects.toThrow(/needs internet access/);
    } finally {
      loaded.dispose();
    }
  }, 30_000);
});

describe("isolation", () => {
  it("exposes no host globals", async () => {
    const found = await probe(`
      export function activate() {
        return {
          probe: () => ({
            process: typeof process,
            require: typeof require,
            fetch: typeof fetch,
            globalFetch: typeof globalThis.fetch,
            Buffer: typeof Buffer,
            setTimeout: typeof setTimeout,
            XMLHttpRequest: typeof XMLHttpRequest,
            WebAssembly: typeof WebAssembly,
          }),
        };
      }
    `);

    expect(found).toEqual({
      process: "undefined",
      require: "undefined",
      fetch: "undefined",
      globalFetch: "undefined",
      Buffer: "undefined",
      setTimeout: "undefined",
      XMLHttpRequest: "undefined",
      WebAssembly: "undefined",
    });
  }, 30_000);

  it("cannot reach the host through Function or eval constructors", async () => {
    const found = await probe(`
      export function activate() {
        return {
          probe: () => {
            const attempts = {};
            try {
              attempts.functionCtor = new Function("return typeof process")();
            } catch (error) { attempts.functionCtor = "threw"; }
            try {
              attempts.indirectEval = (0, eval)("typeof process");
            } catch (error) { attempts.indirectEval = "threw"; }
            try {
              // The classic prototype walk out of a naive sandbox.
              attempts.ctorWalk = ({}).constructor.constructor("return typeof process")();
            } catch (error) { attempts.ctorWalk = "threw"; }
            return attempts;
          },
        };
      }
    `);

    // Even where the constructors exist, they resolve inside the isolate, so
    // the host is still not reachable.
    for (const value of Object.values(found as Record<string, string>)) {
      expect(value === "undefined" || value === "threw").toBe(true);
    }
  }, 30_000);

  it("cannot import any module but its own", async () => {
    const runtime = createQuickJSRuntime();

    await expect(
      runtime.load({
        extensionId: "sneaky",
        source: `import { readFile } from "node:fs/promises"; export function activate() { return {}; }`,
        bridge: bridge(),
      }),
    ).rejects.toBeInstanceOf(ExtensionExecutionError);
  }, 30_000);
});

describe("resource limits", () => {
  it("interrupts an infinite loop instead of hanging", async () => {
    const runtime = createQuickJSRuntime();
    const loaded = await runtime.load({
      extensionId: "spin",
      source: `export function activate() { return { probe: () => { while (true) {} } }; }`,
      bridge: bridge(),
      limits: { memoryBytes: 32 * 1024 * 1024, timeoutMs: 500, maxInstructions: 1_000_000 },
    });

    try {
      const started = Date.now();
      await expect(
        loaded.call("probe", [], AbortSignal.timeout(20_000)),
      ).rejects.toBeInstanceOf(ExtensionExecutionError);
      // Proves the interrupt fired rather than the outer signal.
      expect(Date.now() - started).toBeLessThan(15_000);
    } finally {
      loaded.dispose();
    }
  }, 30_000);

  it("stops an extension that tries to exhaust memory, without taking the host down", async () => {
    const runtime = createQuickJSRuntime();
    const loaded = await runtime.load({
      extensionId: "hog",
      source: `export function activate() {
        return { probe: () => { const held = []; for (;;) held.push(new Array(100000).fill("x")); } };
      }`,
      bridge: bridge(),
      limits: { memoryBytes: 8 * 1024 * 1024, timeoutMs: 10_000, maxInstructions: 1_000_000 },
    });

    await expect(
      loaded.call("probe", [], AbortSignal.timeout(20_000)),
    ).rejects.toBeInstanceOf(ExtensionExecutionError);

    // The guest wrecked its own VM, so QuickJS cannot free it cleanly. That is
    // survivable; the host process crashing is not.
    expect(() => loaded.dispose()).not.toThrow();
  }, 30_000);
});

describe("the host boundary", () => {
  it("surfaces a denied host call as a catchable guest error", async () => {
    const denied = bridge({
      fetch: async () => {
        throw new Error("evil.test is not one of the hosts you allowed");
      },
    });

    const result = await probe(
      `export function activate({ host }) {
        return {
          probe: async () => {
            try {
              await host.fetch({ url: "https://evil.test/x" });
              return "allowed";
            } catch (error) {
              return "blocked: " + error.message;
            }
          },
        };
      }`,
      denied,
    );

    expect(String(result)).toMatch(/blocked/);
  }, 30_000);

  it("passes only plain data across the boundary", async () => {
    const seen: unknown[] = [];
    const recording = bridge({
      fetch: async (request) => {
        seen.push(request);
        return { status: 200, headers: {}, body: "{}" };
      },
    });

    await probe(
      `export function activate({ host }) {
        return {
          probe: async () => {
            await host.fetch({ url: "https://openlibrary.org/x", sneaky: () => 1 });
            return null;
          },
        };
      }`,
      recording,
    );

    // The function was dropped by JSON serialisation at the boundary.
    expect(seen[0]).toEqual({ url: "https://openlibrary.org/x" });
  }, 30_000);
});
