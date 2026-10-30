import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  SourceManager,
  secureSourceUrl,
  sourceOptions,
} from "./source-manager";
import type { RemoteSourcePlan, SourceSummary } from "../shared/sources";

const manifestSchema = sourceOptions.extend({
  hosts: sourceOptions.shape.hosts.default([]),
  preferences: sourceOptions.shape.preferences.default({}),
  version: z.string().trim().min(1).max(80),
  payloadURI: secureSourceUrl,
  language: z.enum(["javascript", "typescript"]).optional(),
  sha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
});
type Staged = {
  plan: RemoteSourcePlan;
  source: string;
  filename: string;
  options: z.infer<typeof sourceOptions>;
  old?: SourceSummary;
  expires: number;
};
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export class RemoteSourceService {
  private staged = new Map<string, Staged>();
  constructor(
    private manager: SourceManager,
    private download: (url: string) => Promise<Uint8Array>,
    private now: () => number = Date.now,
  ) {}
  private async bytes(url: string, cap: number) {
    const bytes = await this.download(secureSourceUrl.parse(url));
    if (!bytes.length || bytes.length > cap)
      throw new Error(`Source artifact must contain 1–${cap} bytes.`);
    return bytes;
  }
  async prepare(
    url: string,
    updatingId?: string,
    providedManifest?: unknown,
  ): Promise<RemoteSourcePlan> {
    const manifestUrl = secureSourceUrl.parse(url);
    const current = await this.manager.list();
    const old = updatingId
      ? current.find((row) => row.id === updatingId)
      : undefined;
    if (updatingId && (!old?.remote || old.remote.manifestUrl !== manifestUrl))
      throw new Error("This source has no matching remote update origin.");
    const manifest = manifestSchema.parse(
      providedManifest ??
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            await this.bytes(manifestUrl, 65536),
          ),
        ),
    );
    if (old && (old.id !== manifest.id || old.type !== manifest.type))
      throw new Error(
        "The remote manifest changed source identity or content type.",
      );
    if (!old && current.some((row) => row.id === manifest.id))
      throw new Error(
        "That source is already installed. Use Check for updates on its existing entry.",
      );
    const bytes = await this.bytes(manifest.payloadURI, 1048576);
    const digest = hash(bytes);
    if (manifest.sha256 && manifest.sha256.toLowerCase() !== digest)
      throw new Error("Downloaded script does not match the manifest SHA256.");
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const filename =
      manifest.language === "typescript" ||
      /\.ts$/i.test(new URL(manifest.payloadURI).pathname)
        ? "provider.ts"
        : "provider.js";
    const suggestedHosts: string[] = [];
    if (!manifest.hosts.length)
      for (const match of source.matchAll(
        /https:\/\/([a-zA-Z0-9.-]+)(?=[:/\s"'`})]|$)/g,
      )) {
        const host = match[1]!.toLowerCase();
        if (
          sourceOptions.shape.hosts.safeParse([host]).success &&
          !suggestedHosts.includes(host)
        )
          suggestedHosts.push(host);
        if (suggestedHosts.length === 32) break;
      }
    const proposedHosts = manifest.hosts.length
      ? manifest.hosts
      : suggestedHosts;
    const hosts = [...new Set([...(old?.hosts ?? []), ...proposedHosts])];
    const token = randomUUID();
    const plan: RemoteSourcePlan = {
      token,
      id: manifest.id,
      name: old?.name ?? manifest.name,
      type: manifest.type,
      version: manifest.version,
      currentVersion: old?.remote?.version,
      manifestUrl,
      payloadUrl: manifest.payloadURI,
      sha256: digest,
      checksumVerified: !!manifest.sha256,
      hosts,
      addedHosts: proposedHosts.filter((host) => !old?.hosts.includes(host)),
      inferredHosts: !manifest.hosts.length && proposedHosts.length > 0,
      updating: !!old,
      changed:
        !old ||
        old.remote?.version !== manifest.version ||
        old.remote?.sha256 !== digest,
    };
    for (const [key, stage] of this.staged)
      if (stage.expires < this.now()) this.staged.delete(key);
    if (this.staged.size >= 4)
      this.staged.delete(this.staged.keys().next().value!);
    this.staged.set(token, {
      plan,
      source,
      filename,
      old,
      options: sourceOptions.parse(manifest),
      expires: this.now() + 600000,
    });
    return plan;
  }
  async check(id: string): Promise<RemoteSourcePlan> {
    const row = (await this.manager.list()).find((row) => row.id === id);
    if (!row?.remote)
      throw new Error("This source was not installed from a manifest URL.");
    return this.prepare(row.remote.manifestUrl, id);
  }
  async apply(token: string, selectedHosts: unknown): Promise<void> {
    const stage = this.staged.get(z.string().uuid().parse(token));
    if (!stage || stage.expires < this.now())
      throw new Error("This review expired. Preview the manifest again.");
    const hosts = sourceOptions.shape.hosts.parse(selectedHosts);
    const remote = {
      manifestUrl: stage.plan.manifestUrl,
      version: stage.plan.version,
      sha256: stage.plan.sha256,
    };
    if (stage.old) {
      await this.manager.applyRemote(
        stage.old.id,
        { source: stage.source, filename: stage.filename, remote },
        hosts,
        stage.old.sourceHash,
        stage.old.remote!.version,
      );
    } else {
      await this.manager.install({
        ...stage.options,
        hosts,
        source: stage.source,
        filename: stage.filename,
        remote,
        enabled: true,
      });
    }
    this.staged.delete(token);
  }
}
