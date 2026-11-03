import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { StorageDriver } from "@vestra/storage";
import { FOUNDRY_REGISTRY_URL } from "@vestra/types";
import type { GuardedTransport } from "@vestra/extension-host/net";
import {
  buildInstallRecord,
  completeInstall,
  prepareInstall,
  type InstalledExtension,
  type InstallCandidate,
} from "@vestra/extension-host/install";
import {
  getInstalled,
  listInstalled,
  readSource,
  saveInstalled,
} from "@vestra/extension-host/store";
import { parseRegistry } from "@vestra/provider-sdk/marketplace";
import type {
  ExtensionUpdateReview,
  ExtensionUpdateSummary,
} from "../shared/extension-updates";
import { registryFetchUrl } from "./extension-registry";

let changes: Promise<unknown> = Promise.resolve();
export function serializeExtensionChange<T>(run: () => Promise<T>): Promise<T> {
  const next = changes.then(run);
  changes = next.catch(() => undefined);
  return next;
}
const signature = (record: InstalledExtension) => JSON.stringify(record);
type Stage = {
  review: ExtensionUpdateReview;
  old: InstalledExtension;
  source: string;
  expires: number;
};
export class ExtensionUpdater {
  private staged = new Map<string, Stage>();
  constructor(
    private driver: StorageDriver,
    private transport: GuardedTransport,
    private activate: (
      record: InstalledExtension,
      source: string,
    ) => Promise<void>,
    private bundledManifest: (id: string) => string | null = () => null,
    private now = Date.now,
  ) {}
  private async candidate(old: InstalledExtension): Promise<InstallCandidate> {
    const shipped = this.bundledManifest(old.id);
    const bundled =
      shipped &&
      !old.manifestURI.startsWith("https:") &&
      resolve(old.manifestURI) === resolve(shipped);
    const origin = bundled ? FOUNDRY_REGISTRY_URL : old.registryUrl;
    if (origin.startsWith("https://")) {
      const response = await this.transport.request({
        url: registryFetchUrl(origin),
        method: "GET",
        headers: { Accept: "application/json" },
        body: null,
        maxBytes: 2 * 1048576,
        timeoutMs: 20000,
      });
      if (response.status !== 200)
        throw Error(`The update registry returned HTTP ${response.status}.`);
      const matches = parseRegistry(
        JSON.parse(response.body),
        registryFetchUrl(origin),
      ).entries.filter((entry) => entry.id === old.id);
      if (matches.length !== 1)
        throw Error(
          "The original registry must contain exactly one matching extension listing.",
        );
      const entry = matches[0]!;
      if (
        entry.unsupportedReason ||
        entry.tags.includes("installation-blocked")
      )
        throw Error(
          entry.unsupportedReason ||
            "This extension is currently blocked for installation.",
        );
      return {
        id: entry.id,
        name: entry.name,
        version: entry.version,
        type: old.type,
        manifestURI: entry.manifestURI,
        payloadURI: entry.payloadURI,
        registryUrl: origin,
      };
    }
    if (!old.manifestURI.startsWith("https://"))
      throw Error(
        "This local extension has no remote update origin. Update its reviewed Foundry snapshot or reinstall from a manifest URL.",
      );
    return {
      id: old.id,
      name: old.name,
      version: old.version,
      type: old.type,
      manifestURI: old.manifestURI,
      payloadURI: "",
      registryUrl: old.registryUrl,
    };
  }
  private async preview(
    id: string,
    stage: boolean,
  ): Promise<ExtensionUpdateReview> {
    const old = await getInstalled(this.driver, id);
    if (!old) throw Error("This extension is no longer installed.");
    const plan = await prepareInstall(
      await this.candidate(old),
      this.transport,
    );
    if (plan.manifest.role !== old.manifest.role)
      throw Error("An update cannot change the extension's runtime role.");
    const downloaded = await completeInstall(plan, [], this.transport);
    const changed =
      downloaded.record.integrity !== old.integrity ||
      JSON.stringify(plan.manifest) !== JSON.stringify(old.manifest);
    const addedPermissions = plan.requested.filter(
      (permission) => !old.grant.granted.includes(permission),
    );
    const addedHosts = plan.hosts.filter(
      (host) => !old.grant.allowedHosts.includes(host),
    );
    const review: ExtensionUpdateReview = {
      token: randomUUID(),
      id,
      currentVersion: old.version,
      version: plan.manifest.version,
      changed,
      enabled: old.enabled !== false,
      retainedPermissions: old.grant.granted.filter((permission) =>
        plan.requested.includes(permission),
      ),
      addedPermissions,
      addedHosts,
      plan: {
        ...plan,
        warnings: [
          ...plan.warnings,
          ...(addedPermissions.length
            ? [`New permissions: ${addedPermissions.join(", ")}.`]
            : []),
          ...(addedHosts.length
            ? [`New host access: ${addedHosts.join(", ")}.`]
            : []),
          ...(changed && old.version === plan.manifest.version
            ? [
                "The code or manifest changed without a version bump. Review this update carefully.",
              ]
            : []),
          ...(old.enabled === false
            ? ["This extension will remain disabled after the update."]
            : []),
        ],
      },
    };
    if (stage && changed) {
      for (const [key, value] of this.staged)
        if (value.expires < this.now()) this.staged.delete(key);
      if (this.staged.size >= 16)
        this.staged.delete(this.staged.keys().next().value!);
      this.staged.set(review.token, {
        review: structuredClone(review),
        old,
        source: downloaded.source,
        expires: this.now() + 600000,
      });
    }
    return review;
  }
  prepare(id: string) {
    return this.preview(id, true);
  }
  async checkAll(): Promise<ExtensionUpdateSummary[]> {
    const rows = (await listInstalled(this.driver)).slice(0, 100);
    const result: ExtensionUpdateSummary[] = [];
    for (const old of rows) {
      try {
        const review = await this.preview(old.id, false);
        result.push({
          id: old.id,
          name: old.name,
          kind: "sdk",
          currentVersion: old.version,
          version: review.version,
          status: review.changed ? "available" : "current",
          message: review.changed
            ? "An update is available for review."
            : "Installed code and manifest are current.",
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Update check failed.";
        result.push({
          id: old.id,
          name: old.name,
          kind: "sdk",
          currentVersion: old.version,
          status: message.includes("local extension") ? "local" : "error",
          message,
        });
      }
    }
    return result;
  }
  apply(token: string, selected: string[]): Promise<InstalledExtension> {
    return serializeExtensionChange(async () => {
      const stage = this.staged.get(token);
      if (!stage || stage.expires < this.now())
        throw Error("This update review expired. Check for updates again.");
      this.staged.delete(token);
      const current = await getInstalled(this.driver, stage.old.id);
      if (!current || signature(current) !== signature(stage.old))
        throw Error(
          "The installed extension changed after review. Check for updates again.",
        );
      const oldSource = await readSource(this.driver, current);
      if (oldSource === null)
        throw Error("The installed extension failed its fingerprint check.");
      const granted = stage.review.plan.requested.filter((permission) =>
        selected.includes(permission),
      );
      if (
        selected.some(
          (permission) =>
            !stage.review.plan.requested.some(
              (requested) => requested === permission,
            ),
        )
      )
        throw Error("Cannot grant unrequested permissions.");
      const built = buildInstallRecord(
        stage.review.plan,
        granted,
        stage.source,
      );
      const next = {
        ...built.record,
        enabled: current.enabled,
        installedAt: current.installedAt,
      };
      try {
        await this.activate(next, stage.source);
        await saveInstalled(this.driver, next, stage.source);
      } catch (error) {
        try {
          await this.activate(current, oldSource);
        } catch {
          throw Error(
            "The update failed. The previous version remains saved but could not be restarted; restart Vestra to retry it.",
          );
        }
        throw Error(
          `The update failed; the previous version was restored. ${error instanceof Error ? error.message : "Activation failed."}`,
        );
      }
      return next;
    });
  }
}
