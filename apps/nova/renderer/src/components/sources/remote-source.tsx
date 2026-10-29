import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { bridge } from "@/lib/bridge";
import type { RemoteSourcePlan } from "../../../../shared/sources";
export function RemoteSourceImport({
  disabled,
  onPrepared,
}: {
  disabled: boolean;
  onPrepared: (plan: RemoteSourcePlan) => void;
}) {
  const [url, setUrl] = useState("");
  const prepare = useMutation({
    mutationFn: () => bridge.sources.prepareRemote(url.trim()),
    onSuccess: onPrepared,
  });
  return (
    <form
      className="grid gap-2 pb-5"
      onSubmit={(event) => {
        event.preventDefault();
        prepare.mutate();
      }}
    >
      <label className="text-sm" htmlFor="source-manifest-url">
        Install from manifest URL
      </label>
      <div className="flex gap-2">
        <input
          id="source-manifest-url"
          className="input input-bordered min-w-0 flex-1"
          type="url"
          required
          maxLength={4096}
          value={url}
          placeholder="https://example.org/manifest.json"
          onChange={(event) => setUrl(event.target.value)}
        />
        <button className="btn" disabled={disabled || prepare.isPending}>
          {prepare.isPending ? "Downloading preview…" : "Preview"}
        </button>
      </div>
      {prepare.error && (
        <p role="alert" className="text-error">
          {prepare.error.message}
        </p>
      )}
    </form>
  );
}
export function RemoteSourceReview({
  plan,
  busy,
  onApply,
  onCancel,
}: {
  plan: RemoteSourcePlan;
  busy: boolean;
  onApply: (hosts: string[]) => void;
  onCancel: () => void;
}) {
  const [hosts, setHosts] = useState(plan.hosts.join("\n"));
  return (
    <section className="grid gap-3 rounded-xl border rule p-5">
      <h2 className="text-lg font-semibold">
        {plan.updating ? "Update" : "Install"} {plan.name}
      </h2>
      <p className="text-sm">
        {plan.type === "manga-provider" ? "Manga" : "Anime"} ·{" "}
        {plan.currentVersion ? `${plan.currentVersion} → ` : ""}
        {plan.version}
      </p>
      <p className="break-all text-xs text-base-content/60">
        Manifest: {plan.manifestUrl}
        <br />
        Script: {plan.payloadUrl}
      </p>
      {!plan.changed && (
        <p role="status">
          The installed version and script match this manifest.
        </p>
      )}
      {!!plan.addedHosts.length && (
        <p className="text-sm">
          Websites requested: {plan.addedHosts.join(", ")}
        </p>
      )}
      <label className="grid gap-1 text-sm">
        Allowed websites
        <textarea
          className="textarea textarea-bordered w-full font-mono"
          rows={3}
          value={hosts}
          onChange={(event) => setHosts(event.target.value)}
        />
        <span className="text-xs text-base-content/60">
          Exact hostnames, one per line. Only the websites you approve here are
          granted.
        </span>
      </label>
      <details className="text-xs text-base-content/60">
        <summary className="cursor-pointer">Download fingerprint</summary>
        <p className="break-all pt-2">SHA256: {plan.sha256}</p>
        <p>
          {plan.checksumVerified
            ? "Matches the checksum declared by the manifest."
            : "The manifest has no checksum; these downloaded bytes are pinned to this review."}
        </p>
      </details>
      <div className="flex gap-2">
        <button
          className="btn btn-primary"
          disabled={busy || !plan.changed}
          onClick={() =>
            onApply([...new Set(hosts.split(/[\s,]+/).filter(Boolean))])
          }
        >
          {busy
            ? "Applying…"
            : plan.updating
              ? "Apply update"
              : "Install source"}
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
