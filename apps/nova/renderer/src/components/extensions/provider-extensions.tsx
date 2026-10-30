import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { bridge } from "@/lib/bridge";
import {
  RemoteSourceImport,
  RemoteSourceReview,
} from "@/components/sources/remote-source";
import type {
  PickedSource,
  SourceOptions,
  SourceSummary,
  RemoteSourcePlan,
} from "../../../../shared/sources";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export function ProviderExtensions() {
  const cache = useQueryClient();
  const sources = useQuery({
    queryKey: ["managed-sources"],
    queryFn: bridge.sources.list,
  });
  const [picked, setPicked] = useState<PickedSource | null>(null);
  const [editing, setEditing] = useState<SourceSummary | null>(null);
  const [replacing, setReplacing] = useState<SourceSummary | null>(null);
  const [remote, setRemote] = useState<RemoteSourcePlan | null>(null);
  const reviewRemote = (plan: RemoteSourcePlan) => {
    setRemote(plan);
    setPicked(null);
    setEditing(null);
    setReplacing(null);
  };
  const refresh = async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["managed-sources"] }),
      cache.invalidateQueries({ queryKey: ["manga"] }),
      cache.invalidateQueries({ queryKey: ["anime-sources"] }),
      cache.invalidateQueries({ queryKey: ["playback"] }),
      cache.invalidateQueries({ queryKey: ["anime-source-details"] }),
      cache.invalidateQueries({ queryKey: ["source-episodes"] }),
    ]);
  };
  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSettled: refresh,
  });
  const pick = useMutation({
    mutationFn: async (target: SourceSummary | null) => ({
      file: await bridge.sources.pick(),
      target,
    }),
    onSuccess: ({ file, target }) => {
      if (!file) return;
      setPicked(file);
      setRemote(null);
      setReplacing(target);
      setEditing(null);
      action.reset();
    },
  });
  return (
    <section aria-label="Provider extensions">
      <h2 className="font-serif text-2xl">Provider extensions</h2>
      <p className="mt-2 text-sm text-base-content/60">
        Manage anime and manga extensions, permissions, servers and updates.
      </p>
      <div className="flex items-center justify-between gap-3 py-5">
        <p className="text-sm text-base-content/60">
          JavaScript and TypeScript provider scripts
        </p>
        <button
          className="btn btn-primary"
          disabled={pick.isPending || action.isPending}
          onClick={() => pick.mutate(null)}
        >
          Import script
        </button>
      </div>
      {sources.isPending && <p role="status">Loading provider extensions…</p>}
      {sources.error && <p role="alert">{message(sources.error)}</p>}
      <RemoteSourceImport
        disabled={action.isPending || pick.isPending}
        onPrepared={reviewRemote}
      />
      {remote && (
        <RemoteSourceReview
          key={remote.token}
          plan={remote}
          busy={action.isPending}
          onCancel={() => setRemote(null)}
          onApply={(hosts) =>
            action.mutate(async () => {
              await bridge.sources.applyRemote(remote.token, hosts);
              setRemote(null);
            })
          }
        />
      )}
      {(pick.error || action.error) && (
        <p role="alert" className="py-3 text-error">
          {message(pick.error || action.error)}
        </p>
      )}
      {picked && replacing && (
        <section className="grid gap-3 rounded-xl border rule p-5">
          <h2 className="text-lg font-semibold">
            Replace {replacing.name} script
          </h2>
          <p className="text-sm">
            Use {picked.filename} ({Math.ceil(picked.bytes / 1024)} KiB) for
            this source. Its ID, settings and reading progress are retained.
          </p>
          <p className="text-sm text-base-content/60">
            {replacing.enabled
              ? "The update is loaded and checked before it is saved. A failed update attempts to restore the previous script."
              : "This source stays disabled. Its script will be checked when you enable it."}
          </p>
          <details className="text-xs text-base-content/60">
            <summary className="cursor-pointer">Script fingerprints</summary>
            <p className="break-all pt-2">Current: {replacing.sourceHash}</p>
            <p className="break-all">Selected: {picked.sha256}</p>
          </details>
          <div className="flex gap-2">
            <button
              className="btn btn-primary"
              disabled={action.isPending || pick.isPending}
              onClick={() =>
                action.mutate(async () => {
                  await bridge.sources.replace(
                    replacing.id,
                    picked.token,
                    replacing.sourceHash,
                  );
                  setPicked(null);
                  setReplacing(null);
                })
              }
            >
              {action.isPending ? "Replacing…" : "Replace script"}
            </button>
            <button
              className="btn btn-ghost"
              disabled={action.isPending}
              onClick={() => {
                setPicked(null);
                setReplacing(null);
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
      {(picked || editing) && !replacing && (
        <SourceForm
          key={picked?.token ?? editing!.id}
          picked={picked}
          existing={editing}
          busy={action.isPending}
          onCancel={() => {
            setPicked(null);
            setEditing(null);
            setReplacing(null);
          }}
          onSave={(options) =>
            action.mutate(async () => {
              if (picked) await bridge.sources.install(picked.token, options);
              else if (editing)
                await bridge.sources.update(editing.id, {
                  ...options,
                  enabled: editing.enabled,
                });
              setPicked(null);
              setEditing(null);
            })
          }
        />
      )}
      {sources.data?.length === 0 && (
        <p className="py-10 text-base-content/60">
          No provider extensions installed. Import a script or a manifest to get
          started.
        </p>
      )}
      <div className="grid gap-4 py-4">
        {sources.data?.map((source) => (
          <article key={source.id} className="rounded-xl border rule p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{source.name}</h2>
                <p className="text-sm text-base-content/60">
                  {source.type === "manga-provider" ? "Manga" : "Anime"} ·{" "}
                  {source.id}
                  {source.remote ? ` · ${source.remote.version}` : ""}
                </p>
              </div>
              <span
                className={`badge ${source.status === "error" ? "badge-error" : source.status === "ready" ? "badge-success" : "badge-ghost"}`}
              >
                {source.status === "ready"
                  ? "Loaded"
                  : source.status === "error"
                    ? "Needs attention"
                    : "Disabled"}
              </span>
            </div>
            <p className="break-words py-3 text-sm text-base-content/60">
              Allowed websites: {source.hosts.join(", ") || "None"}
            </p>
            {source.preferredServer && (
              <p className="text-sm">Server: {source.preferredServer}</p>
            )}
            {source.error && (
              <p role="alert" className="py-2 text-error">
                {source.error}
              </p>
            )}
            {source.checkedAt && (
              <p className="py-2 text-xs text-base-content/60">
                Runtime checked {new Date(source.checkedAt).toLocaleString()}.
                Website availability is checked when searching or playing.
              </p>
            )}
            <div className="flex flex-wrap gap-2 pt-3">
              <button
                className="btn btn-sm"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate(() =>
                    bridge.sources.update(source.id, {
                      ...source,
                      enabled: !source.enabled,
                    }),
                  )
                }
              >
                {source.enabled ? "Disable" : "Enable"}
              </button>
              <button
                className="btn btn-sm"
                disabled={action.isPending}
                onClick={() => {
                  setEditing(source);
                  setRemote(null);
                  setPicked(null);
                  setReplacing(null);
                  action.reset();
                }}
              >
                Configure
              </button>
              <button
                className="btn btn-sm"
                disabled={action.isPending || pick.isPending}
                onClick={() => pick.mutate(source)}
              >
                Replace script
              </button>
              <button
                className="btn btn-sm"
                disabled={action.isPending || !source.enabled}
                onClick={() =>
                  action.mutate(() => bridge.sources.check(source.id))
                }
              >
                Check runtime
              </button>
              {source.type === "onlinestream-provider" &&
                source.status === "ready" && (
                  <Link
                    className="btn btn-sm"
                    to={`/anime?source=${encodeURIComponent(`ext-csharp-${source.id}`)}`}
                  >
                    Browse anime
                  </Link>
                )}
              {source.remote && (
                <button
                  className="btn btn-sm"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate(async () =>
                      reviewRemote(
                        await bridge.sources.checkUpdates(source.id),
                      ),
                    )
                  }
                >
                  Check for updates
                </button>
              )}
              <button
                className="btn btn-sm btn-ghost text-error"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate(() => bridge.sources.remove(source.id))
                }
              >
                Remove
              </button>
            </div>
            {!!source.versions.length && (
              <details className="pt-4 text-sm">
                <summary className="cursor-pointer">
                  Previous scripts ({source.versions.length})
                </summary>
                <div className="grid gap-2 pt-2">
                  {source.versions.map((version) => (
                    <div
                      key={version.id}
                      className="flex items-center justify-between gap-3"
                    >
                      <span>
                        {version.version} · {version.sourceHash.slice(0, 12)}
                      </span>
                      <button
                        className="btn btn-sm"
                        disabled={action.isPending}
                        onClick={() =>
                          action.mutate(() =>
                            bridge.sources.rollback(
                              source.id,
                              version.id,
                              source.sourceHash,
                            ),
                          )
                        }
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function SourceForm({
  picked,
  existing,
  busy,
  onCancel,
  onSave,
}: {
  picked: PickedSource | null;
  existing: SourceSummary | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (options: SourceOptions) => void;
}) {
  const base = picked?.filename.replace(/\.(js|ts)$/i, "") || "";
  const [id, setId] = useState(
    existing?.id ?? base.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 100),
  );
  const [name, setName] = useState(existing?.name ?? base);
  const [type, setType] = useState<SourceOptions["type"]>(
    existing?.type ?? "onlinestream-provider",
  );
  const [hosts, setHosts] = useState(existing?.hosts.join("\n") ?? "");
  const [preferences, setPreferences] = useState(
    JSON.stringify(existing?.preferences ?? {}, null, 2),
  );
  const [compatibility, setCompatibility] = useState(
    existing?.compatibility ?? "",
  );
  const [server, setServer] = useState(existing?.preferredServer ?? "");
  const [error, setError] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const parsed: unknown = JSON.parse(preferences);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Preferences must be a JSON object.");
      setError("");
      onSave({
        id,
        name,
        type,
        hosts: [...new Set(hosts.split(/[\s,]+/).filter(Boolean))],
        preferences: parsed as Record<string, unknown>,
        compatibility:
          type === "onlinestream-provider" && compatibility
            ? "animesaturn-nested-player-v1"
            : undefined,
        preferredServer:
          type === "onlinestream-provider"
            ? server.trim() || undefined
            : undefined,
      });
    } catch (e) {
      setError(message(e));
    }
  };
  return (
    <form
      onSubmit={submit}
      className="grid gap-4 rounded-xl border rule bg-base-200/40 p-5"
    >
      <h2 className="text-lg font-semibold">
        {picked ? `Import ${picked.filename}` : `Configure ${existing?.name}`}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          Source ID
          <input
            className="input input-bordered w-full"
            required
            pattern="[a-zA-Z0-9._-]+"
            maxLength={100}
            value={id}
            disabled={!!existing}
            onChange={(e) => setId(e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Name
          <input
            className="input input-bordered w-full"
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </div>
      <label className="grid gap-1 text-sm">
        Content
        <select
          className="select select-bordered w-full"
          value={type}
          onChange={(e) => setType(e.target.value as SourceOptions["type"])}
        >
          <option value="onlinestream-provider">Anime streaming</option>
          <option value="manga-provider">Manga</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        Allowed websites
        <textarea
          className="textarea textarea-bordered w-full font-mono"
          rows={3}
          placeholder={"example.org\ncdn.example.org"}
          value={hosts}
          onChange={(e) => setHosts(e.target.value)}
        />
        <span className="text-xs text-base-content/60">
          Exact hostnames, one per line. Include the websites this provider
          needs.
        </span>
      </label>
      <details>
        <summary className="cursor-pointer text-sm">Advanced settings</summary>
        <div className="grid gap-3 pt-3">
          <label className="grid gap-1 text-sm">
            Preferences (JSON)
            <textarea
              className="textarea textarea-bordered w-full font-mono"
              rows={5}
              maxLength={65536}
              value={preferences}
              onChange={(e) => setPreferences(e.target.value)}
            />
          </label>
          {type === "onlinestream-provider" && (
            <>
              <label className="grid gap-1 text-sm">
                Preferred server
                <input
                  className="input input-bordered w-full"
                  list="source-servers"
                  placeholder="Provider default"
                  maxLength={120}
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                />
                <datalist id="source-servers">
                  {existing?.servers?.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </label>
              <label className="grid gap-1 text-sm">
                Compatibility
                <select
                  className="select select-bordered w-full"
                  value={compatibility}
                  onChange={(e) =>
                    setCompatibility(e.target.value as typeof compatibility)
                  }
                >
                  <option value="">Default</option>
                  <option value="animesaturn-nested-player-v1">
                    AnimeSaturn nested player
                  </option>
                </select>
              </label>
            </>
          )}
        </div>
      </details>
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : picked ? "Import source" : "Save settings"}
        </button>
        <button
          className="btn btn-ghost"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
