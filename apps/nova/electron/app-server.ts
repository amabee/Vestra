import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { connect, createServer } from "node:net";
import { dirname, join } from "node:path";

import { app } from "electron";

/**
 * Runs Nova's app server.
 *
 * The Next.js app in `apps/nova-app` is not just the UI — it owns every route
 * handler, the provider registry, the library scanner and the matcher. Nova
 * ships its `standalone` build and runs it on loopback, which is what makes
 * the desktop app self-contained rather than dependent on a hosted deployment.
 *
 * In development the dev server is already running, so this is skipped.
 */

let serverProcess: ChildProcess | null = null;

/**
 * Tail of the server's own output.
 *
 * Captured rather than inherited: a GUI-launched Electron has no console for
 * the child to write to, which is how a real startup crash turns into a bare
 * "did not start" timeout with no explanation.
 */
let serverOutput: string[] = [];

function recordOutput(chunk: unknown): void {
  serverOutput.push(String(chunk));
  // Keep only the tail; a failing server can be very chatty.
  if (serverOutput.length > 40) serverOutput = serverOutput.slice(-40);
}

function lastServerError(): string {
  return serverOutput.join("");
}

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

/** Where electron-builder places the bundled standalone output. */
function resolveServerEntry(): string | null {
  const candidates = [
    // Packaged: copied in via `extraResources`.
    join(process.resourcesPath, "app", "server.js"),
    // Unpackaged production run from the repo.
    join(app.getAppPath(), "resources", "app", "server.js"),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * Wait until something is listening on the port.
 *
 * A raw TCP connect rather than an HTTP request: we only need to know the
 * listener is up, and probing `/` would render a full page (hitting live
 * provider APIs) on every poll.
 */
function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });

    const finish = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(1_000);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function waitForServer(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // The child dying is terminal; polling on would just burn the full budget
    // and report a timeout instead of the real failure.
    if (serverProcess === null) {
      throw new Error(lastServerError().trim() || "The app server exited during startup.");
    }

    if (await canConnect(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(
    `The app server did not start within ${timeoutMs}ms.` +
      (lastServerError().trim() ? `\n\n${lastServerError().trim()}` : ""),
  );
}

export interface AppServer {
  url: string;
  stop: () => void;
}

export async function startAppServer(options: {
  isDev: boolean;
  /** Directory the app should persist watchlist/progress/library JSON into. */
  dataDir: string;
}): Promise<AppServer> {
  if (options.isDev) {
    return { url: "http://localhost:3000", stop: () => undefined };
  }

  const entry = resolveServerEntry();
  if (!entry) {
    throw new Error(
      "Bundled app server not found.\n\n" +
        "The bundle is generated, not committed. Build it with:\n" +
        "  pnpm --filter @vestra/nova-app build\n" +
        "  pnpm --filter @vestra/nova bundle:app",
    );
  }

  const port = await findFreePort();
  const url = `http://127.0.0.1:${port}`;

  serverOutput = [];

  serverProcess = spawn(process.execPath, [entry], {
    // Run from the bundle so any relative resolution inside Next resolves
    // against the app rather than wherever Electron happened to launch.
    cwd: dirname(entry),
    env: {
      ...process.env,
      // Electron's main process is Node; this makes the child behave as plain
      // Node rather than booting a second Electron instance.
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      // Nova is the only host that may load extensions; the server checks this
      // rather than trusting anything from the renderer.
      VESTRA_HOST: "desktop",
      // Bind to loopback only. The desktop app must never expose the user's
      // library to the local network.
      HOSTNAME: "127.0.0.1",
      VESTRA_DATA_DIR: options.dataDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout?.on("data", recordOutput);
  serverProcess.stderr?.on("data", recordOutput);

  serverProcess.once("error", (error) => {
    recordOutput(`Failed to launch server process: ${error.message}`);
    serverProcess = null;
  });

  serverProcess.once("exit", (code) => {
    if (code !== 0 && code !== null) {
      recordOutput(`\nApp server exited with code ${code}.`);
    }
    serverProcess = null;
  });

  await waitForServer(port);

  return { url, stop: stopAppServer };
}

export function stopAppServer(): void {
  if (!serverProcess) return;
  serverProcess.kill();
  serverProcess = null;
}
