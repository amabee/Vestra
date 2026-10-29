import { isIP } from "node:net";
import { createHash } from "node:crypto";
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
export const secureSourceUrl = z
  .string()
  .url()
  .max(4096)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (!url.port || url.port === "443")
    );
  }, "Use a public HTTPS URL without credentials, fragments or a custom port.");
export const remoteMetadata = z.object({
  manifestUrl: secureSourceUrl,
  version: z.string().trim().min(1).max(80),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const scriptPayload = z.object({
  filename: z
    .string()
    .min(1)
    .max(255)
    .regex(/\.(?:js|ts)$/i),
  source: z
    .string()
    .min(1)
    .refine((s) => Buffer.byteLength(s) <= 1048576, "Source exceeds 1 MiB."),
  remote: remoteMetadata.optional(),
});
const managedSource = sourceOptions.merge(scriptPayload).extend({
  enabled: z.boolean(),
  history: z.array(scriptPayload).max(3).default([]),
});
export type ManagedSource = z.infer<typeof managedSource>;
interface Runtime {
  activate(source: ManagedSource): Promise<void>;
  deactivate(id: string): Promise<void>;
  check(id: string): Promise<unknown>;
}
const registryKey = "csharp-managed-sources";
const revisionId = (row: z.infer<typeof scriptPayload>) =>
  createHash("sha256")
    .update(JSON.stringify([row.filename, row.source, row.remote ?? null]))
    .digest("hex");
const sourceHash = (source: string) =>
  createHash("sha256").update(source).digest("hex");
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
      ({ source: _source, filename: _filename, history, ...row }) => ({
        ...row,
        sourceHash: sourceHash(_source),
        versions: history.map((entry) => ({
          id: revisionId(entry),
          version: entry.remote?.version ?? "Local script",
          sourceHash: sourceHash(entry.source),
        })),
        ...(this.states.get(row.id) ?? { status: "disabled" as const }),
      }),
    );
  }
  replace(id: string, script: unknown, expectedHash: string): Promise<void> {
    return this.serial(async () => {
      const old = this.entries.find((row) => row.id === id);
      if (!old) throw new Error("Source is not installed.");
      if (
        !/^[a-f0-9]{64}$/.test(expectedHash) ||
        sourceHash(old.source) !== expectedHash
      )
        throw new Error(
          "This source changed while the update was being prepared. Reopen the replacement review.",
        );
      const replacement = managedSource
        .pick({ source: true, filename: true })
        .parse(script);
      const next = managedSource.parse({ ...old, ...replacement });
      if (
        old.source === next.source &&
        old.filename === next.filename &&
        !old.remote
      )
        return;
      await this.commitReplacement(old, { ...next, remote: undefined });
    });
  }
  applyRemote(
    id: string,
    script: unknown,
    hosts: unknown,
    expectedHash: string,
    expectedVersion: string,
  ): Promise<void> {
    return this.serial(async () => {
      const old = this.entries.find((row) => row.id === id);
      if (
        !old ||
        sourceHash(old.source) !== expectedHash ||
        old.remote?.version !== expectedVersion
      )
        throw new Error("Source changed. Check for updates again.");
      const payload = scriptPayload.parse(script);
      if (
        !payload.remote ||
        payload.remote.manifestUrl !== old.remote?.manifestUrl
      )
        throw new Error("The update origin changed.");
      await this.commitReplacement(
        old,
        managedSource.parse({
          ...old,
          ...payload,
          hosts: sourceOptions.shape.hosts.parse(hosts),
        }),
      );
    });
  }
  rollback(id: string, revision: string, expectedHash: string): Promise<void> {
    return this.serial(async () => {
      const old = this.entries.find((row) => row.id === id);
      if (!old || sourceHash(old.source) !== expectedHash)
        throw new Error("Source changed. Refresh its version history.");
      const previous = old.history.find(
        (entry) => revisionId(entry) === revision,
      );
      if (!previous)
        throw new Error("That saved version is no longer available.");
      await this.commitReplacement(
        old,
        managedSource.parse({ ...old, ...previous, remote: previous.remote }),
      );
    });
  }
  private async commitReplacement(
    old: ManagedSource,
    next: ManagedSource,
  ): Promise<void> {
    const id = old.id;
    const history = [
      { source: old.source, filename: old.filename, remote: old.remote },
      ...old.history,
    ]
      .filter((entry) => revisionId(entry) !== revisionId(next))
      .slice(0, 3);
    next = { ...next, history };
    const rows = this.entries.map((row) => (row.id === id ? next : row));
    if (!old.enabled) {
      // Replacing a disabled source must not execute its script.
      await this.driver.write(registryKey, rows);
      this.entries = rows;
      this.states.set(id, { status: "disabled" });
      return;
    }
    const previousState = this.states.get(id);
    try {
      await this.runtime.deactivate(id);
      await this.runtime.activate(next);
      const settings = await this.settingsFor(next);
      await this.driver.write(registryKey, rows);
      this.entries = rows;
      this.states.set(id, {
        status: "ready",
        checkedAt: new Date().toISOString(),
        servers: settings.episodeServers,
      });
    } catch (error) {
      // The persisted entry is still old. Remove any partial candidate and restore it.
      await this.start(old);
      const restored = this.states.get(id)?.status === "ready";
      if (restored && previousState) this.states.set(id, previousState);
      const detail = error instanceof Error ? error.message : String(error);
      const recovery = this.states.get(id)?.error;
      throw new Error(
        restored
          ? `Script replacement failed; the previous script was restored. ${detail}`
          : `Script replacement failed; the previous script remains saved, but could not be restarted. ${detail} ${recovery ?? ""}`,
      );
    }
  }
  private async settingsFor(row: ManagedSource) {
    const settings = z
      .object({ episodeServers: z.array(z.string()).optional() })
      .parse(await this.runtime.check(row.id));
    if (
      row.preferredServer &&
      !settings.episodeServers?.includes(row.preferredServer)
    )
      throw new Error("The selected server is not advertised by this source.");
    return settings;
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
