import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

import { app } from "electron";

/**
 * Runs the Atlas server inside Nova.
 *
 * Atlas is not just the UI — it owns every route handler, the provider
 * registry, the library scanner and the matcher. Nova therefore ships the
 * Next.js `standalone` build and runs it locally, which is what makes the
 * desktop app self-contained instead of depending on a hosted deployment.
 *
 * In development the Atlas dev server is already running, so this is skipped.
 */

let serverProcess: ChildProcess | null = null;

/** Ask the OS for an unused port rather than guessing a fixed one. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();

    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close();
        reject(new Error("Could not determine a free port."));
        return;
      }

      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

/** Where electron-builder places the bundled Atlas standalone output. */
function resolveServerEntry(): string | null {
  const candidates = [
    // Packaged: copied in via `extraResources`.
    join(process.resourcesPath, "atlas", "server.js"),
    // Unpackaged production run from the repo.
    join(app.getAppPath(), "resources", "atlas", "server.js"),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** Poll the server until it answers, so the window never loads a dead URL. */
async function waitForServer(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      // Any HTTP response means the listener is up; status does not matter.
      await fetch(url, { signal: AbortSignal.timeout(1_000) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(`Atlas server did not start within ${timeoutMs}ms.`);
}

export interface AtlasServer {
  url: string;
  stop: () => void;
}

export async function startAtlasServer(options: {
  isDev: boolean;
  /** Directory Atlas should persist watchlist/progress/library JSON into. */
  dataDir: string;
}): Promise<AtlasServer> {
  if (options.isDev) {
    return { url: "http://localhost:3000", stop: () => undefined };
  }

  const entry = resolveServerEntry();
  if (!entry) {
    throw new Error(
      "Bundled Atlas server not found. Run `pnpm --filter @vestra/nova bundle:atlas` before packaging.",
    );
  }

  const port = await findFreePort();
  const url = `http://127.0.0.1:${port}`;

  serverProcess = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      // Electron's main process is Node; this makes the child behave as plain
      // Node rather than booting a second Electron instance.
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      // Bind to loopback only. The desktop app must never expose the user's
      // library to the local network.
      HOSTNAME: "127.0.0.1",
      VESTRA_DATA_DIR: options.dataDir,
    },
    stdio: "inherit",
  });

  serverProcess.once("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[nova] Atlas server exited with code ${code}`);
    }
    serverProcess = null;
  });

  await waitForServer(url);

  return { url, stop: stopAtlasServer };
}

export function stopAtlasServer(): void {
  if (!serverProcess) return;
  serverProcess.kill();
  serverProcess = null;
}
