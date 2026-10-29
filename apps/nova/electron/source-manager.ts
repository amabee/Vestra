import { isIP } from "node:net";
import { z } from "zod";
import type { StorageDriver } from "@vestra/storage";
import type { SourceSummary } from "../shared/sources";

export const sourceId = z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/);
export const sourceOptions = z.object({
  id: sourceId,
  name: z.string().trim().min(1).max(200),
  type: z.enum(["onlinestream-provider", "manga-provider"]),
  hosts: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .max(253)
        .refine(
          (h) =>
            !isIP(h) &&
            h.includes(".") &&
            h
              .split(".")
              .every((label) =>
                /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
              ),
          "Use exact DNS hostnames without a protocol or wildcard.",
        ),
    )
    .max(32),
  preferences: z
    .record(z.string(), z.unknown())
    .refine(
      (p) => Buffer.byteLength(JSON.stringify(p)) <= 65536,
      "Preferences exceed 64 KiB.",
    ),
  compatibility: z.enum(["animesaturn-nested-player-v1"]).optional(),
  preferredServer: z.string().trim().min(1).max(120).optional(),
});
const managedSource = sourceOptions.extend({
  filename: z
    .string()
    .min(1)
    .max(255)
    .regex(/\.(?:js|ts)$/i),
  source: z
    .string()
    .min(1)
    .refine((s) => Buffer.byteLength(s) <= 1048576, "Source exceeds 1 MiB."),
  enabled: z.boolean(),
});
export type ManagedSource = z.infer<typeof managedSource>;
interface Runtime {
  activate(source: ManagedSource): Promise<void>;
  deactivate(id: string): Promise<void>;
  check(id: string): Promise<unknown>;
}
const registryKey = "csharp-managed-sources";
export class SourceManager {
  private entries: ManagedSource[] = [];
  private states = new Map<
    string,
    Pick<SourceSummary, "status" | "error" | "servers" | "checkedAt">
  >();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private driver: StorageDriver,
    private runtime: Runtime,
  ) {}
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }
  async initialize(seed: () => Promise<ManagedSource[]>): Promise<void> {
    return this.serial(async () => {
      const saved = await this.driver.read(registryKey);
      const rows = z
        .array(managedSource)
        .max(32)
        .parse(saved === null ? await seed() : saved);
      if (new Set(rows.map((r) => r.id)).size !== rows.length)
        throw new Error("Source IDs must be unique.");
      if (saved === null) await this.driver.write(registryKey, rows);
      this.entries = rows;
      for (const row of rows) await this.start(row);
    });
  }
  private async start(row: ManagedSource) {
    try {
      await this.runtime.deactivate(row.id);
      if (!row.enabled) {
        this.states.set(row.id, { status: "disabled" });
        return;
      }
      await this.runtime.activate(row);
      this.states.set(row.id, { status: "ready" });
    } catch (error) {
      // A failed activation may have loaded the worker before registry attachment.
      try {
        await this.runtime.deactivate(row.id);
      } catch {
        /* Preserve the original failure. */
      }
      this.states.set(row.id, {
        status: "error",
        error: String(error instanceof Error ? error.message : error).slice(
          0,
          2000,
        ),
      });
    }
  }
  async list(): Promise<SourceSummary[]> {
    await this.queue;
    return this.entries.map(
      ({ source: _source, filename: _filename, ...row }) => ({
        ...row,
        ...(this.states.get(row.id) ?? { status: "disabled" as const }),
      }),
    );
  }
  install(input: unknown): Promise<void> {
    return this.serial(async () => {
      const row = managedSource.parse(input);
      if (this.entries.some((r) => r.id === row.id))
        throw new Error("That source ID is already installed.");
      if (this.entries.length >= 32)
        throw new Error("At most 32 sources can be installed.");
      const next = [...this.entries, row];
      await this.driver.write(registryKey, next);
      this.entries = next;
      await this.start(row);
    });
  }
  update(id: string, input: unknown): Promise<void> {
    return this.serial(async () => {
      const old = this.entries.find((r) => r.id === id);
      if (!old) throw new Error("Source is not installed.");
      const patch = sourceOptions
        .omit({ id: true })
        .extend({ enabled: z.boolean() })
        .parse(input);
      const row = managedSource.parse({ ...old, ...patch });
      await this.driver.write(
        registryKey,
        this.entries.map((r) => (r.id === id ? row : r)),
      );
      this.entries = this.entries.map((r) => (r.id === id ? row : r));
      await this.start(row);
    });
  }
  remove(id: string): Promise<void> {
    return this.serial(async () => {
      if (!this.entries.some((r) => r.id === id))
        throw new Error("Source is not installed.");
      const next = this.entries.filter((r) => r.id !== id);
      await this.driver.write(registryKey, next);
      this.entries = next;
      this.states.delete(id);
      await this.runtime.deactivate(id);
    });
  }
  check(id: string): Promise<void> {
    return this.serial(async () => {
      const row = this.entries.find((r) => r.id === id);
      if (!row?.enabled)
        throw new Error("Enable the source before checking it.");
      if (this.states.get(id)?.status !== "ready") await this.start(row);
      if (this.states.get(id)?.status !== "ready") return;
      const checkedAt = new Date().toISOString();
      let servers: string[] | undefined;
      try {
        const settings = z
          .object({ episodeServers: z.array(z.string()).optional() })
          .parse(await this.runtime.check(id));
        servers = settings.episodeServers;
        if (
          row.preferredServer &&
          !settings.episodeServers?.includes(row.preferredServer)
        )
          throw new Error(
            "The selected server is not advertised by this source.",
          );
        this.states.set(id, {
          status: "ready",
          checkedAt,
          servers: settings.episodeServers,
        });
      } catch (error) {
        this.states.set(id, {
          status: "error",
          checkedAt,
          servers,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }
}
