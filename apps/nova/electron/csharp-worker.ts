import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

interface PendingCall {
  id: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

/** Private stdio bridge. The renderer never receives a port, script or handle. */
export class CSharpProviderWorker {
  get isFailed(): boolean {
    return this.failure !== null;
  }
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly ready: Promise<void>;
  private acceptReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private pending: PendingCall | null = null;
  private queue: Promise<void> = Promise.resolve();
  private buffer = "";
  private sequence = 0;
  private failure: Error | null = null;

  constructor(dllPath: string, dataDir?: string) {
    this.ready = new Promise((resolve, reject) => {
      this.acceptReady = resolve;
      this.rejectReady = reject;
    });
    void this.ready.catch(() => undefined);
    this.child = spawn("dotnet", [dllPath, "--provider-worker"], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...(dataDir ? { VESTRA_PROVIDER_DATA_DIR: dataDir } : {}),
      },
    });
    const startupTimer = setTimeout(
      () => this.stop(new Error("C# provider worker startup timed out.")),
      10_000,
    );
    void this.ready.then(
      () => clearTimeout(startupTimer),
      () => clearTimeout(startupTimer),
    );
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.receive(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) =>
      console.warn("[csharp-provider]", chunk.slice(0, 2000)),
    );
    this.child.on("error", (error) => this.stop(error));
    this.child.stdin.on("error", (error) => this.stop(error));
    this.child.on("exit", (code) =>
      this.stop(new Error(`C# provider worker exited (${String(code)}).`)),
    );
  }

  request(
    command: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const result = this.queue.then(async () => {
      await this.ready;
      if (this.failure) throw this.failure;
      signal?.throwIfAborted();
      return new Promise<unknown>((resolve, reject) => {
        const id = `cs-${++this.sequence}`;
        const abort = () =>
          this.stop(
            new Error("C# provider operation cancelled; worker stopped."),
          );
        const timer = setTimeout(
          () =>
            this.stop(
              new Error("C# provider operation exceeded its deadline."),
            ),
          15_000,
        );
        const cleanup = () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
        };
        this.pending = { id, resolve, reject, cleanup };
        signal?.addEventListener("abort", abort, { once: true });
        const line = JSON.stringify({ ...command, id }) + "\n";
        if (Buffer.byteLength(line) > 2_097_152) {
          this.pending = null;
          cleanup();
          reject(new Error("C# provider request exceeds 2 MiB."));
          return;
        }
        this.child.stdin.write(line, (error) => {
          if (error) this.stop(error);
        });
      });
    });
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 4_194_304) {
      this.stop(
        new Error("C# provider worker response exceeds protocol limit."),
      );
      return;
    }
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line) as Record<string, unknown>;
        if (message.kind === "ready" && message.protocol === 1) {
          this.acceptReady();
        } else if (this.pending && message.id === this.pending.id) {
          const pending = this.pending;
          this.pending = null;
          pending.cleanup();
          if (message.ok === true) pending.resolve(message.value);
          else
            pending.reject(
              new Error(String(message.error ?? "C# provider call failed.")),
            );
        } else throw new Error("Unexpected worker response.");
      } catch (error) {
        this.stop(
          error instanceof Error
            ? error
            : new Error("Invalid worker response."),
        );
        return;
      }
    }
  }

  stop(error = new Error("C# provider worker stopped.")): void {
    if (this.failure) return;
    this.failure = error;
    this.rejectReady(error);
    this.pending?.cleanup();
    this.pending?.reject(error);
    this.pending = null;
    this.child.kill();
  }
}

/** Replays successful loads after a worker crash; never retries an interrupted call. */
export class CSharpProviderSession {
  private worker: CSharpProviderWorker;
  private queue: Promise<void> = Promise.resolve();
  private stopped = false;
  private readonly definitions = new Map<string, Record<string, unknown>>();
  constructor(
    private readonly dllPath: string,
    private readonly dataDir?: string,
  ) {
    this.worker = new CSharpProviderWorker(dllPath, dataDir);
  }
  request(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const command = structuredClone(input);
    const result = this.queue.then(async () => {
      if (this.stopped) throw new Error("C# provider session stopped.");
      signal?.throwIfAborted();
      if (this.worker.isFailed) {
        this.worker = new CSharpProviderWorker(this.dllPath, this.dataDir);
        try {
          for (const provider of this.definitions.values())
            await this.worker.request({ kind: "load", provider }, signal);
        } catch (error) {
          this.worker.stop();
          throw error;
        }
      }
      const value = await this.worker.request(command, signal);
      if (
        command.kind === "load" &&
        command.provider &&
        typeof command.provider === "object"
      ) {
        const provider = command.provider as Record<string, unknown>;
        if (typeof provider.id === "string")
          this.definitions.set(provider.id, provider);
      }
      if (command.kind === "unload" && typeof command.providerId === "string")
        this.definitions.delete(command.providerId);
      return value;
    });
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  stop(): void {
    this.stopped = true;
    this.worker.stop();
    this.definitions.clear();
  }
}
