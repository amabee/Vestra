import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { Notice, Page, PageHeader, SectionRule } from "@/components/layout/page";
import { bridge, type ScanSummary } from "@/lib/bridge";
import { keys, useDiagnostics, useSettings } from "@/lib/queries";

/**
 * Settings.
 *
 * Read-only for now, and honest about it. Provider credentials come from the
 * environment rather than the UI, so the useful thing this screen can do today
 * is tell you what is actually connected — which is the question you have when
 * a section comes up empty.
 */
export function SettingsRoute() {
  const { data: diagnostics } = useDiagnostics();
  const { data: settings } = useSettings();

  return (
    <Page>
      <PageHeader
        eyebrow="System"
        title="Settings"
        lead="Connections are configured through environment variables and never stored in the app."
      />

      <MediaFolders />

      <section className="mt-10">
        <SectionRule label="Sources" count={diagnostics?.providers.length} />
        <div>
          {(diagnostics?.providers ?? []).map((provider) => (
            <div
              key={provider.id}
              className="flex items-center justify-between gap-4 border-b rule px-2 py-3"
            >
              <div className="flex items-center gap-3">
                <span
                  className={[
                    "size-1.5 rounded-full",
                    provider.available ? "bg-success" : "bg-base-300",
                  ].join(" ")}
                />
                <span className="text-sm">{provider.name}</span>
              </div>
              <span className="meta">
                {provider.available ? "ready" : "not configured"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <SectionRule label="Storage" />
        <Row label="Data directory" value={diagnostics?.dataDir ?? "—"} mono />
        <Row label="Files indexed" value={String(diagnostics?.counts.localFiles ?? 0)} />
        <Row label="On watchlist" value={String(diagnostics?.counts.watchlist ?? 0)} />
        <Row
          label="Media folders"
          value={String(settings?.library.folders.length ?? 0)}
        />
      </section>

      <section className="mt-10">
        <SectionRule label="Playback" />
        <Row
          label="Mark watched at"
          value={`${Math.round((settings?.playback.markWatchedAt ?? 0.9) * 100)}%`}
        />
        <Row
          label="Autoplay next"
          value={settings?.playback.autoplayNext ? "on" : "off"}
        />
        <Row
          label="Seek step"
          value={`${settings?.playback.seekStepSeconds ?? 10}s`}
        />
      </section>
    </Page>
  );
}

/**
 * Media folders.
 *
 * The only genuinely writable part of Settings, and the one that matters: with
 * no folder configured the local library can never contain anything, which
 * makes the rest of the app a metadata browser.
 */
function MediaFolders() {
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState<ScanSummary | null>(null);

  const { data: folders = [] } = useQuery({
    queryKey: ["library-folders"],
    queryFn: () => bridge.library.folders(),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["library-folders"] });
    void queryClient.invalidateQueries({ queryKey: keys.library });
    void queryClient.invalidateQueries({ queryKey: keys.libraryEntries });
    void queryClient.invalidateQueries({ queryKey: keys.diagnostics });
  };

  const pick = useMutation({
    mutationFn: () => bridge.library.pickFolder(),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: string) => bridge.library.removeFolder(id),
    onSuccess: refresh,
  });

  const scan = useMutation({
    mutationFn: () => bridge.library.scan(),
    onSuccess: (result) => {
      setSummary(result);
      refresh();
    },
  });

  return (
    <section className="mt-10">
      <SectionRule
        label="Media folders"
        count={folders.length}
        trailing={
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pick.isPending}
              onClick={() => pick.mutate()}
              className="flex items-center gap-1.5 rounded-field border rule px-2.5 py-1 text-xs transition-colors hover:border-primary/40 hover:text-primary"
            >
              <FolderPlus className="size-3.5" />
              Add
            </button>
            <button
              type="button"
              disabled={scan.isPending || folders.length === 0}
              onClick={() => scan.mutate()}
              className="flex items-center gap-1.5 rounded-field border border-primary/40 px-2.5 py-1 text-xs text-primary transition-colors hover:bg-primary hover:text-primary-content disabled:opacity-40"
            >
              {scan.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Scan
            </button>
          </div>
        }
      />

      {folders.length === 0 ? (
        <Notice
          title="No folders added"
          body="Add a folder and run a scan to index what you own."
        />
      ) : (
        <div>
          {folders.map((folder) => (
            <div
              key={folder.id}
              className="group flex items-center gap-4 border-b rule px-2 py-2.5"
            >
              <span
                data-selectable
                className="min-w-0 flex-1 truncate font-mono text-[12px] text-base-content/75"
                title={folder.path}
              >
                {folder.path}
              </span>
              <button
                type="button"
                aria-label="Remove folder"
                onClick={() => remove.mutate(folder.id)}
                className="grid size-7 place-items-center rounded-field text-base-content/40 opacity-0 transition-all hover:bg-error hover:text-error-content group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {scan.error ? (
        <p className="mt-3 text-xs text-error">{(scan.error as Error).message}</p>
      ) : null}

      {summary ? (
        <p className="meta mt-3">
          {summary.scanned} scanned · {summary.added} added · {summary.removed} removed ·{" "}
          {summary.matched} matched · {summary.unmatched} unmatched
          {summary.errors.length > 0 ? ` · ${summary.errors.length} errors` : ""}
        </p>
      ) : null}
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b rule px-2 py-2.5">
      <span className="text-sm text-base-content/60">{label}</span>
      <span
        data-selectable
        className={[
          "truncate text-right text-sm",
          mono ? "font-mono text-[12px] text-base-content/75" : "",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

/* =============================================================================
 * Extensions
 * ========================================================================== */

export function ExtensionsRoute() {
  const { data: diagnostics } = useDiagnostics();
  const loaded = diagnostics?.extensions ?? [];

  return (
    <Page>
      <PageHeader
        eyebrow="System"
        title="Extensions"
        lead="Community extensions run in an isolate with no filesystem access and no network beyond the hosts you allow."
      />

      <section className="mt-10">
        <SectionRule label="Loaded" count={loaded.length} />
        {loaded.length === 0 ? (
          <Notice
            title="No extensions installed"
            body="The runtime is built and the isolate works, but there is no install surface in this UI yet."
          />
        ) : (
          <div>
            {loaded.map((id) => (
              <div key={id} className="flex items-center gap-3 border-b rule px-2 py-3">
                <span className="size-1.5 rounded-full bg-success" />
                <span className="font-mono text-[13px]">{id}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </Page>
  );
}
