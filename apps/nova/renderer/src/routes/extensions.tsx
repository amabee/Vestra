import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PERMISSION_DESCRIPTORS } from "@vestra/extension-host/permissions";
import {
  EXTENSION_TYPE_LABEL,
  EXTENSION_TYPE_SUPPORT,
  healthOf,
  isPinnedRef,
} from "@vestra/provider-sdk/marketplace";
import { AlertTriangle, Loader2, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { useState } from "react";

import { Notice, Page, PageHeader, SectionRule } from "@/components/layout/page";
import {
  bridge,
  type BrowseEntry,
  type InstallCandidate,
  type InstallPlan,
} from "@/lib/bridge";

/**
 * Extensions.
 *
 * The runtime for these has existed for a while — isolates, content-addressed
 * installs, brokered network — with no way to install one. This is that
 * surface: point the app at a registry, look at what a listing asks for, and
 * decide.
 *
 * Nothing is bundled. Vestra ships no registry of its own, so the list is
 * empty until the user adds one, and what they add is their call.
 *
 * Types Vestra will not run are still listed, with the reason, and cannot be
 * installed. Hiding them would suggest the registry was smaller than it is;
 * offering them would suggest the refusal is temporary.
 */
export function ExtensionsRoute() {
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = useState<InstallPlan | null>(null);

  const installed = useQuery({
    queryKey: ["extensions", "installed"],
    queryFn: () => bridge.extensions.installed(),
  });

  /*
    Installed and running are not the same thing. Stored code is re-verified
    against its fingerprint at startup, so an extension whose payload was
    altered on disk is present here and deliberately not loaded.
  */
  const running = useQuery({
    queryKey: ["extensions", "running"],
    queryFn: () => bridge.extensions.list(),
  });

  const registries = useQuery({
    queryKey: ["extensions", "registries"],
    queryFn: () => bridge.extensions.registries(),
  });

  const browse = useQuery({
    queryKey: ["extensions", "browse", registries.data],
    queryFn: () => bridge.extensions.browse(),
    enabled: (registries.data ?? []).length > 0,
  });

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["extensions"] });

  const setRegistries = useMutation({
    mutationFn: (urls: string[]) => bridge.extensions.setRegistries(urls),
    onSuccess: refresh,
  });

  const prepare = useMutation({
    mutationFn: (candidate: InstallCandidate) => bridge.extensions.prepare(candidate),
    onSuccess: setReviewing,
  });

  const install = useMutation({
    mutationFn: (input: { candidate: InstallCandidate; granted: string[] }) =>
      bridge.extensions.install(input),
    onSuccess: () => {
      setReviewing(null);
      refresh();
    },
  });

  const uninstall = useMutation({
    mutationFn: (id: string) => bridge.extensions.uninstall(id),
    onSuccess: refresh,
  });

  const installedIds = new Set((installed.data ?? []).map((entry) => entry.id));
  const runningIds = new Set(running.data ?? []);

  return (
    <Page>
      <PageHeader
        eyebrow="System"
        title="Extensions"
        lead="Community extensions run in an isolate with no filesystem access and no network beyond the hosts you allow."
      />

      <Registries
        urls={registries.data ?? []}
        busy={setRegistries.isPending}
        error={setRegistries.error as Error | null}
        onChange={(urls) => setRegistries.mutate(urls)}
      />

      <section className="mt-10">
        <SectionRule label="Installed" count={installed.data?.length} />

        {(installed.data ?? []).length === 0 ? (
          <Notice
            title="Nothing installed"
            body="Add a registry below to see what is available."
          />
        ) : (
          <div className="space-y-2">
            {(installed.data ?? []).map((entry) => (
              <article
                key={entry.id}
                className="flex items-start gap-4 rounded-box border rule bg-base-200/40 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      title={runningIds.has(entry.id) ? "Running" : "Not running"}
                      className={`size-1.5 shrink-0 rounded-full ${
                        runningIds.has(entry.id) ? "bg-success" : "bg-base-content/25"
                      }`}
                    />
                    <p className="truncate text-sm">{entry.name}</p>
                    <span className="meta">v{entry.version}</span>
                    {entry.driftDetectedAt ? (
                      <span className="meta flex items-center gap-1 text-warning">
                        <AlertTriangle className="size-3" />
                        code changed
                      </span>
                    ) : null}
                  </div>

                  <p className="filename truncate">{entry.id}</p>

                  <p className="meta mt-1">
                    {entry.grant.granted.length === 0
                      ? "No permissions"
                      : entry.grant.granted.join(" · ")}
                    {entry.grant.allowedHosts.length > 0
                      ? ` · ${entry.grant.allowedHosts.join(", ")}`
                      : ""}
                  </p>
                </div>

                <button
                  type="button"
                  aria-label={`Uninstall ${entry.name}`}
                  disabled={uninstall.isPending}
                  onClick={() => uninstall.mutate(entry.id)}
                  className="grid size-8 shrink-0 place-items-center rounded-field text-base-content/40 transition-colors hover:bg-error hover:text-error-content"
                >
                  <Trash2 className="size-4" />
                </button>
              </article>
            ))}
          </div>
        )}

        {uninstall.error ? (
          <p className="mt-3 text-xs text-error">{(uninstall.error as Error).message}</p>
        ) : null}
      </section>

      <section className="mt-10">
        <SectionRule
          label="Available"
          count={browse.data?.entries.length}
          trailing={
            browse.isFetching ? (
              <Loader2 className="size-3.5 animate-spin text-base-content/40" />
            ) : null
          }
        />

        {(registries.data ?? []).length === 0 ? (
          <Notice
            title="No registry configured"
            body="Vestra ships no marketplace of its own. Add the URL of a registry you trust."
          />
        ) : browse.error ? (
          <Notice title="Could not browse" body={(browse.error as Error).message} />
        ) : (browse.data?.entries ?? []).length === 0 && !browse.isFetching ? (
          <Notice title="Nothing listed" body="The registry returned no usable entries." />
        ) : (
          <div className="space-y-2">
            {(browse.data?.entries ?? []).map((entry) => (
              <AvailableRow
                key={`${entry.registryUrl}:${entry.id}`}
                entry={entry}
                installed={installedIds.has(entry.id)}
                busy={prepare.isPending}
                onReview={() =>
                  prepare.mutate({
                    id: entry.id,
                    name: entry.name,
                    version: entry.version,
                    type: entry.type,
                    manifestURI: entry.manifestURI,
                    payloadURI: entry.payloadURI,
                    registryUrl: entry.registryUrl,
                  })
                }
              />
            ))}
          </div>
        )}

        {browse.data?.errors.map((problem) => (
          <p key={problem.registryUrl} className="mt-3 text-xs text-error">
            {problem.registryUrl}: {problem.message}
          </p>
        ))}

        {browse.data && browse.data.rejected > 0 ? (
          <p className="meta mt-3">
            {browse.data.rejected} listing(s) skipped — malformed
          </p>
        ) : null}

        {prepare.error ? (
          <p className="mt-3 text-xs text-error">{(prepare.error as Error).message}</p>
        ) : null}
      </section>

      {reviewing ? (
        <ReviewDialog
          plan={reviewing}
          busy={install.isPending}
          error={install.error as Error | null}
          onCancel={() => setReviewing(null)}
          onInstall={(granted) =>
            install.mutate({ candidate: reviewing.candidate, granted })
          }
        />
      ) : null}
    </Page>
  );
}

/** Registry URLs the user has chosen to browse. */
function Registries({
  urls,
  busy,
  error,
  onChange,
}: {
  urls: string[];
  busy: boolean;
  error: Error | null;
  onChange: (urls: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  return (
    <section className="mt-10">
      <SectionRule label="Registries" count={urls.length} />

      <form
        className="mb-3 mt-4 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = draft.trim();
          if (value.length === 0) return;
          onChange([...new Set([...urls, value])]);
          setDraft("");
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="https://example.com/registry.json"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-field border rule bg-base-200/40 px-3 py-1.5 font-mono text-xs outline-none focus:border-primary/40"
        />
        <button
          type="submit"
          disabled={busy || draft.trim().length === 0}
          className="flex items-center gap-1.5 rounded-field border border-primary/40 px-2.5 py-1.5 text-xs text-primary transition-colors hover:bg-primary hover:text-primary-content disabled:opacity-40"
        >
          <Plus className="size-3.5" />
          Add
        </button>
      </form>

      {urls.length === 0 ? (
        <p className="meta">
          None added. Only https addresses are accepted, and private or loopback
          addresses are refused.
        </p>
      ) : (
        <div>
          {urls.map((url) => (
            <div
              key={url}
              className="group flex items-center gap-3 border-b rule px-2 py-2"
            >
              <span
                data-selectable
                className="min-w-0 flex-1 truncate font-mono text-[12px] text-base-content/75"
                title={url}
              >
                {url}
              </span>
              <button
                type="button"
                aria-label={`Remove ${url}`}
                onClick={() => onChange(urls.filter((entry) => entry !== url))}
                className="grid size-7 place-items-center rounded-field text-base-content/40 opacity-0 transition-all hover:bg-error hover:text-error-content group-hover:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {error ? <p className="mt-3 text-xs text-error">{error.message}</p> : null}
    </section>
  );
}

/** One registry listing. */
function AvailableRow({
  entry,
  installed,
  busy,
  onReview,
}: {
  entry: BrowseEntry;
  installed: boolean;
  busy: boolean;
  onReview: () => void;
}) {
  const support = EXTENSION_TYPE_SUPPORT[entry.type];
  const health = healthOf(entry);

  /*
    Some registries put the code's URL in the manifest rather than the listing.
    Vestra needs it up front — it is what the integrity fingerprint is taken
    of, and what "pinned to a commit" is judged from — so a listing without one
    cannot be installed. Better to say so on the row than to fail after a click
    with a validation error about a URL the user never saw.
  */
  const installable = support.supported && entry.payloadURI.length > 0;

  return (
    <article className="flex items-start gap-4 rounded-box border rule bg-base-200/40 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm">{entry.name}</p>
          <span className="meta">v{entry.version}</span>
          <span className="meta rounded-selector border rule px-1.5">
            {EXTENSION_TYPE_LABEL[entry.type]}
          </span>
          {health === "broken" ? (
            <span className="meta text-error">reported broken</span>
          ) : null}
          {health === "deprecated" ? (
            <span className="meta text-warning">deprecated</span>
          ) : null}
        </div>

        {entry.description ? (
          <p className="mt-1 text-xs text-base-content/60">{entry.description}</p>
        ) : null}

        {/* The refusal is a decision, not a gap, so the reason is shown in
            full rather than reduced to a disabled button. */}
        {support.supported ? null : (
          <p className="mt-2 max-w-[70ch] text-xs text-base-content/50">{support.reason}</p>
        )}

        {support.supported && !installable ? (
          <p className="mt-2 max-w-[70ch] text-xs text-base-content/50">
            This listing does not say where its code lives, so Vestra has
            nothing to fingerprint. That is a gap in the registry entry rather
            than anything about the extension itself.
          </p>
        ) : null}
      </div>

      {installable ? (
        <button
          type="button"
          disabled={busy || installed}
          onClick={onReview}
          className="shrink-0 rounded-field border border-primary/40 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-primary hover:text-primary-content disabled:opacity-40"
        >
          {installed ? "Installed" : "Review"}
        </button>
      ) : (
        <span className="meta shrink-0 self-center">
          {support.supported ? "No code listed" : "Not installable"}
        </span>
      )}
    </article>
  );
}

/**
 * The consent step.
 *
 * Every permission starts unchecked. A prompt that arrives pre-agreed is not a
 * prompt, and an extension that genuinely needs a capability will not work
 * until it is given one — which is a better way to find out what it actually
 * uses than taking the manifest's word for it.
 */
function ReviewDialog({
  plan,
  busy,
  error,
  onCancel,
  onInstall,
}: {
  plan: InstallPlan;
  busy: boolean;
  error: Error | null;
  onCancel: () => void;
  onInstall: (granted: string[]) => void;
}) {
  const [granted, setGranted] = useState<string[]>([]);

  const toggle = (permission: string) =>
    setGranted((current) =>
      current.includes(permission)
        ? current.filter((entry) => entry !== permission)
        : [...current, permission],
    );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Install ${plan.manifest.name}`}
        className="max-h-full w-full max-w-xl overflow-y-auto rounded-box border rule bg-base-100 p-6 shadow-2xl"
      >
        <p className="meta">Install</p>
        <h2 className="mt-1 font-serif text-display-sm">{plan.manifest.name}</h2>
        <p className="filename mt-1">
          {plan.manifest.id} · v{plan.manifest.version}
        </p>

        <div className="mt-4 flex items-center gap-2">
          {plan.pinned ? (
            <span className="meta flex items-center gap-1 text-success">
              <ShieldCheck className="size-3.5" />
              pinned to a fixed commit
            </span>
          ) : (
            <span className="meta flex items-center gap-1 text-warning">
              <AlertTriangle className="size-3.5" />
              served from a branch
            </span>
          )}
        </div>

        <SectionRule label="Permissions" />

        {plan.requested.length === 0 ? (
          <p className="mt-3 text-xs text-base-content/60">
            Asks for nothing. It cannot reach the network or read your library.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {plan.requested.map((permission) => {
              const descriptor = PERMISSION_DESCRIPTORS[permission];
              const on = granted.includes(permission);

              return (
                <label
                  key={permission}
                  className={`flex cursor-pointer gap-3 rounded-box border px-3 py-2.5 transition-colors ${
                    on ? "border-primary/40 bg-primary/5" : "rule bg-base-200/30"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(permission)}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm">{descriptor.title}</span>
                    <span className="mt-0.5 block text-xs text-base-content/55">
                      {descriptor.risk}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {plan.hosts.length > 0 ? (
          <>
            <SectionRule label="Hosts it may contact" />
            <p className="filename mt-2">{plan.hosts.join(", ")}</p>
          </>
        ) : null}

        {plan.warnings.length > 0 ? (
          <>
            <SectionRule label="Worth knowing" />
            <ul className="mt-2 space-y-1.5">
              {plan.warnings.map((warning) => (
                <li key={warning} className="text-xs text-base-content/60">
                  {warning}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {error ? <p className="mt-4 text-xs text-error">{error.message}</p> : null}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-field border rule px-3 py-1.5 text-xs transition-colors hover:bg-base-200"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onInstall(granted)}
            className="flex items-center gap-2 rounded-field bg-primary px-4 py-1.5 text-xs text-primary-content transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {granted.length === 0 && plan.requested.length > 0
              ? "Install with no permissions"
              : "Install"}
          </button>
        </div>
      </div>
    </div>
  );
}
