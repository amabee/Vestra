import { connect, type Socket } from "node:net";

/**
 * mpv's JSON IPC.
 *
 * mpv exposes a socket (a named pipe on Windows) speaking newline-delimited
 * JSON. Requests carry a `request_id` and replies echo it; property changes
 * arrive unsolicited as events. That is the whole protocol.
 *
 * This is deliberately a socket client and not a binding against libmpv. Two
 * reasons, and the licensing one is the stronger: linking libmpv would make
 * this application a derivative work of a GPL library, whereas driving a
 * separate mpv process over a socket keeps them separate programs. It also
 * means a crash in the decoder cannot take the application down with it.
 */

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface MpvEvent {
  event: string;
  name?: string;
  data?: unknown;
  reason?: string;
  [key: string]: unknown;
}

interface MpvMessage {
  request_id?: number;
  error?: string;
  data?: unknown;
  event?: string;
}

/** How long a single command may take before it is considered lost. */
const REQUEST_TIMEOUT_MS = 10_000;

export class MpvConnection {
  #socket: Socket | null = null;
  #buffer = "";
  #nextRequestId = 1;
  #pending = new Map<number, PendingRequest>();
  #listeners = new Set<(event: MpvEvent) => void>();
  #closed = false;

  /**
   * Connect, retrying briefly.
   *
   * mpv creates its socket a moment after the process starts, so the first
   * attempts are expected to fail. Retrying is normal startup, not an error
   * path.
   */
  async connect(pipePath: string, attempts = 40): Promise<void> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        this.#socket = await openSocket(pipePath);
        this.#attach(this.#socket);
        return;
      } catch (error) {
        if (attempt === attempts - 1) {
          throw new Error(
            `Could not connect to mpv: ${error instanceof Error ? error.message : "unknown"}`,
          );
        }
        await delay(50);
      }
    }
  }

  #attach(socket: Socket): void {
    socket.setEncoding("utf8");

    socket.on("data", (chunk: string) => {
      this.#buffer += chunk;

      // Messages are newline-delimited; a chunk may hold several or half of one.
      let newline = this.#buffer.indexOf("\n");
      while (newline !== -1) {
        const line = this.#buffer.slice(0, newline).trim();
        this.#buffer = this.#buffer.slice(newline + 1);
        if (line) this.#dispatch(line);
        newline = this.#buffer.indexOf("\n");
      }
    });

    socket.on("close", () => this.#failAll("mpv closed the connection."));
    socket.on("error", (error) => this.#failAll(error.message));
  }

  #dispatch(line: string): void {
    let message: MpvMessage;
    try {
      message = JSON.parse(line) as MpvMessage;
    } catch {
      return; // mpv occasionally writes non-JSON noise; ignore it.
    }

    if (typeof message.request_id === "number") {
      const pending = this.#pending.get(message.request_id);
      if (!pending) return;

      this.#pending.delete(message.request_id);
      clearTimeout(pending.timer);

      if (message.error && message.error !== "success") {
        pending.reject(new Error(message.error));
      } else {
        pending.resolve(message.data);
      }
      return;
    }

    if (message.event) {
      const event = message as MpvEvent;
      for (const listener of this.#listeners) listener(event);
    }
  }

  #failAll(reason: string): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.#pending.clear();
  }

  onEvent(listener: (event: MpvEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Send a command and wait for its reply. */
  async command(...args: unknown[]): Promise<unknown> {
    if (this.#closed || !this.#socket) throw new Error("mpv is not running.");

    const requestId = this.#nextRequestId;
    this.#nextRequestId += 1;

    const payload = `${JSON.stringify({ command: args, request_id: requestId })}\n`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error(`mpv did not answer "${String(args[0])}" in time.`));
      }, REQUEST_TIMEOUT_MS);

      this.#pending.set(requestId, { resolve, reject, timer });

      this.#socket?.write(payload, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.#pending.delete(requestId);
        reject(error);
      });
    });
  }

  async setProperty(name: string, value: unknown): Promise<void> {
    await this.command("set_property", name, value);
  }

  async getProperty<T>(name: string): Promise<T> {
    return (await this.command("get_property", name)) as T;
  }

  /**
   * Ask mpv to report changes to a property.
   *
   * Polling `time-pos` would mean a round trip several times a second; an
   * observer pushes it instead.
   */
  async observeProperty(id: number, name: string): Promise<void> {
    await this.command("observe_property", id, name);
  }

  close(): void {
    this.#closed = true;
    this.#failAll("mpv was shut down.");
    this.#socket?.destroy();
    this.#socket = null;
  }
}

function openSocket(pipePath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(pipePath);

    const onError = (error: Error) => {
      socket.destroy();
      reject(error);
    };

    socket.once("error", onError);
    socket.once("connect", () => {
      socket.off("error", onError);
      resolve(socket);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
