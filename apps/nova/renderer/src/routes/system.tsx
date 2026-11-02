import { AppUpdatesPanel } from "@/components/updates/app-updates";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, Loader2, RefreshCw, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";

import {
  Notice,
  Page,
  PageHeader,
  SectionRule,
} from "@/components/layout/page";
import { bridge, type ScanSummary } from "@/lib/bridge";
import { keys, useDiagnostics, useSettings } from "@/lib/queries";

export function SettingsRoute() {
  const { data: diagnostics } = useDiagnostics();
  const { data: settings } = useSettings();

  return (
    <Page>
      <PageHeader
        eyebrow="System"
        title="Settings"
        lead="Manage your media folders and catalogue connections."
      />

      <AppUpdatesPanel />
      <TmdbConnection />
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
        <Row
          label="Files indexed"
          value={String(diagnostics?.counts.localFiles ?? 0)}
        />
        <Row
          label="On watchlist"
          value={String(diagnostics?.counts.watchlist ?? 0)}
        />
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

function TmdbConnection() {
  const client = useQueryClient();
  const status = useQuery({
    queryKey: ["tmdb-credentials"],
    queryFn: bridge.settings.tmdbStatus,
  });
  const [accessToken, setAccessToken] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");
  const save = useMutation({
    mutationFn: bridge.settings.saveTmdb,
    onSuccess: async (_, value) => {
      setAccessToken("");
      setApiKey("");
      setMessage(
        value
          ? "TMDb credentials saved. The new configuration applies immediately."
          : "Saved credentials removed. Environment configuration applies if present.",
      );
      await client.invalidateQueries();
    },
  });
  return (
    <section className="mt-10">
      <SectionRule label="TMDb connection" />
      <p className="mt-3 text-sm text-base-content/60">
        Movie and series metadata. Use an API Read Access Token (recommended) or
        a v3 API key from{" "}
        <a
          className="link"
          href="https://www.themoviedb.org/settings/api"
          target="_blank"
          rel="noreferrer"
        >
          your TMDb account
        </a>
        . Credentials are encrypted on this computer and kept outside
        extensions.
      </p>
      <p className="my-3 meta" role="status">
        {status.isPending
          ? "Checking connection configuration…"
          : status.data?.configured
            ? `Configured through ${status.data.source}`
            : "Not configured"}
      </p>
      {status.data?.loadError && (
        <p role="alert" className="text-sm text-warning">
          Saved credentials could not be opened. Enter them again or remove the
          saved connection.
        </p>
      )}
      {status.error && <p role="alert">Could not read connection settings.</p>}
      <form
        className="mt-4 grid max-w-xl gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setMessage("");
          save.mutate({ accessToken, apiKey });
        }}
      >
        <label className="grid gap-1 text-sm">
          API Read Access Token
          <input
            className="input input-bordered w-full"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder="Enter a new token"
            disabled={save.isPending}
          />
        </label>
        <label className="grid gap-1 text-sm">
          API key (v3)
          <input
            className="input input-bordered w-full"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Or enter a v3 key"
            disabled={save.isPending}
          />
        </label>
        <div className="flex gap-2">
          <button
            className="btn btn-primary btn-sm"
            disabled={
              save.isPending ||
              !status.data?.encryptionAvailable ||
              !(accessToken.trim() || apiKey.trim())
            }
          >
            {save.isPending ? "Saving…" : "Save connection"}
          </button>
          {(status.data?.saved || status.data?.loadError) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={save.isPending}
              onClick={() => {
                setMessage("");
                save.mutate(null);
              }}
            >
              Remove saved credentials
            </button>
          )}
        </div>
      </form>
      {status.data && !status.data.encryptionAvailable && (
        <p role="alert" className="mt-3 text-sm">
          Secure storage is unavailable. Configure TMDB_ACCESS_TOKEN or
          TMDB_API_KEY in the environment.
        </p>
      )}
      {save.error && (
        <p role="alert" className="mt-3 text-sm text-error">
          {save.error.message}
        </p>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm text-success">
          {message}
        </p>
      )}
    </section>
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
  const [rematched, setRematched] = useState<{
    matched: number;
    unmatched: number;
    reidentified: number;
    remapped: number;
  } | null>(null);

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

  /**
   * Identify everything again from scratch.
   *
   * A scan leaves files that already carry a match alone, so a library built
   * by an earlier version keeps whatever it was given — including matches made
   * before the matcher knew that each anime season is a separate entry.
   */
  const rematch = useMutation({
    mutationFn: () => bridge.library.rematch(),
    onSuccess: (result) => {
      setRematched(result);
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
              // Not gated on folders: this re-reads the existing index rather
              // than the disk, and an index can outlive the folder it came from.
              disabled={rematch.isPending}
              onClick={() => rematch.mutate()}
              title="Look up every file again, replacing existing matches"
              className="flex items-center gap-1.5 rounded-field border rule px-2.5 py-1 text-xs transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
            >
              {rematch.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Wand2 className="size-3.5" />
              )}
              Re-identify
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
        <p className="mt-3 text-xs text-error">
          {(scan.error as Error).message}
        </p>
      ) : null}

      {rematch.error ? (
        <p className="mt-3 text-xs text-error">
          {(rematch.error as Error).message}
        </p>
      ) : null}

      {rematched ? (
        <p className="meta mt-3">
          {rematched.matched} matched · {rematched.unmatched} unmatched ·{" "}
          {rematched.reidentified} re-identified
          {rematched.remapped > 0
            ? ` · ${rematched.remapped} kept their progress`
            : ""}
        </p>
      ) : null}

      {summary ? (
        <p className="meta mt-3">
          {summary.scanned} scanned · {summary.added} added · {summary.removed}{" "}
          removed · {summary.matched} matched · {summary.unmatched} unmatched
          {summary.errors.length > 0
            ? ` · ${summary.errors.length} errors`
            : ""}
        </p>
      ) : null}
    </section>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
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
 * Extensions live in their own route file — see routes/extensions.tsx
 * ========================================================================== */
