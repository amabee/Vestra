import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Settings, SettingsPatch } from "@vestra/types";
import { bridge } from "@/lib/bridge";
import { useSettingMatch } from "./search";
const accountKey = ["anilist-account"];
const date = (value: number | null | undefined) =>
  value ? new Date(value).toLocaleString() : "Never";
export function AniListConnection({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: SettingsPatch) => void;
}) {
  const matches = useSettingMatch(
    "Local account AniList connect disconnect backup status automatic lists",
  );
  const cache = useQueryClient();
  useEffect(
    () =>
      bridge.anilistAccount.onChanged((value) =>
        cache.setQueryData(accountKey, value),
      ),
    [cache],
  );
  const status = useQuery({
    queryKey: accountKey,
    queryFn: bridge.anilistAccount.status,
    refetchInterval: (query) =>
      query.state.data?.backingUp ||
      ["waiting", "connecting"].includes(query.state.data?.login?.phase ?? "")
        ? 2000
        : 30000,
    staleTime: 0,
    retry: false,
  });
  const [notice, setNotice] = useState("");
  const action = useMutation({
    mutationFn: async (value: {
      kind:
        | "sign-in"
        | "cancel-sign-in"
        | "disconnect"
        | "backup"
        | "export"
        | "sync";
    }) => {
      setNotice("");
      if (value.kind === "sync") return bridge.anilistAccount.sync();
      if (value.kind === "sign-in") return bridge.anilistAccount.signIn();
      if (value.kind === "cancel-sign-in")
        return bridge.anilistAccount.cancelSignIn();
      if (value.kind === "disconnect")
        return bridge.anilistAccount.disconnect();
      if (value.kind === "backup") return bridge.anilistAccount.backup();
      if (value.kind === "export") {
        const saved = await bridge.anilistAccount.exportLatest();
        setNotice(
          saved
            ? "Backup exported. This file includes private list data, but no credentials."
            : "Export canceled.",
        );
        return;
      }
    },
    onSuccess: (value) => {
      if (value) cache.setQueryData(accountKey, value);
    },
    onSettled: () => cache.invalidateQueries({ queryKey: accountKey }),
  });
  if (!matches) return null;
  const value = status.data;
  const signingIn =
    value?.login?.phase === "waiting" || value?.login?.phase === "connecting";
  return (
    <section className="settings-section" data-settings-search-match={matches}>
      <h3 className="font-serif text-2xl">Local account & AniList</h3>
      <p className="my-3 text-sm text-base-content/60">
        {value?.connected
          ? "Your anime and manga lists sync with AniList. Pending changes and list backups are encrypted on this computer."
          : "Sign in to sync your anime and manga lists and keep encrypted backups."}
      </p>
      <p role="status" className="my-3 text-sm">
        {status.isPending
          ? "Checking account…"
          : value?.connected
            ? `Connected as ${value.user?.name}`
            : value?.needsReconnect
              ? "Authorization expired or revoked. Reconnect to resume backups."
              : value?.loadError
                ? "Saved account could not be decrypted. Reconnect or disconnect to reset it."
                : "Not connected"}
      </p>
      {value?.user && (
        <a
          className="link text-sm"
          href={value.user.url}
          target="_blank"
          rel="noreferrer"
        >
          {value.user.name} · AniList #{value.user.id}
        </a>
      )}
      {!value?.connected && (
        <div className="my-4 flex flex-wrap items-center gap-3">
          <button
            className="btn btn-primary btn-sm"
            disabled={
              status.isPending ||
              action.isPending ||
              !value?.encryptionAvailable ||
              value?.login?.configured === false ||
              signingIn
            }
            onClick={() => action.mutate({ kind: "sign-in" })}
          >
            {value?.login?.phase === "connecting"
              ? "Finishing sign-in…"
              : signingIn
                ? "Waiting for AniList…"
                : value?.needsReconnect
                  ? "Reconnect with AniList"
                  : "Sign in with AniList"}
          </button>
          {signingIn && (
            <button
              className="btn btn-ghost btn-sm"
              disabled={action.isPending}
              onClick={() => action.mutate({ kind: "cancel-sign-in" })}
            >
              Cancel sign-in
            </button>
          )}
          <p className="text-sm text-base-content/50">
            {signingIn
              ? "Approve access in your browser. Vestra will connect automatically."
              : "Sign in in your browser. Vestra connects when you approve access."}
          </p>
        </div>
      )}
      {value?.login?.message && (
        <p role="alert" className="my-3 text-sm text-warning">
          {value.login.message}
        </p>
      )}
      {value?.login?.configured === false && (
        <p role="alert" className="my-3 text-sm text-warning">
          AniList sign-in is unavailable in this build. Please update Vestra.
        </p>
      )}
      {value && !value.encryptionAvailable && (
        <p role="alert" className="mt-3 text-error text-sm">
          Secure storage is unavailable. Account connection and backups are
          disabled.
        </p>
      )}
      {(value?.connected || value?.needsReconnect || value?.loadError) && (
        <div className="my-3">
          {" "}
          <button
            className="btn btn-ghost btn-sm"
            disabled={action.isPending}
            onClick={() => {
              action.mutate({ kind: "disconnect" });
            }}
          >
            Disconnect AniList
          </button>
        </div>
      )}
      {(value?.connected || value?.user) && (
        <div className="mt-4 border-t rule pt-3">
          <h4 className="font-medium">List sync</h4>
          <p className="my-2 text-sm text-base-content/60">
            Watchlist and reading shelf additions are saved to AniList. Playlist
            additions save the title as planned; playlist names and ordering
            stay in Vestra. Watching and reading update progress when an episode
            or numbered chapter is completed. Existing AniList lists appear in
            Vestra automatically.
          </p>
          <button
            className="btn btn-sm"
            disabled={
              action.isPending ||
              !value.connected ||
              value.sync?.syncing ||
              (value.sync?.retryAt ?? 0) > Date.now()
            }
            onClick={() => action.mutate({ kind: "sync" })}
          >
            {value.sync?.syncing ? "Syncing…" : "Sync AniList now"}
          </button>
          <p role="status" className="my-2 text-sm">
            Last sync: {date(value.sync?.lastSyncAt)} ·{" "}
            {value.sync?.pending ?? 0} pending
          </p>
          {!!value.sync?.unmatched && (
            <p className="text-sm text-warning">
              {value.sync.unmatched} titles need an exact AniList match. Open
              the matching catalogue title to link the reading source.
            </p>
          )}
          {value.sync?.retryAt && (
            <p className="text-sm">Next retry: {date(value.sync.retryAt)}</p>
          )}
          {value.sync?.lastError && (
            <p role="alert" className="text-sm text-warning">
              {value.sync.lastError}
            </p>
          )}
        </div>
      )}
      {(value?.connected || value?.user) && (
        <details className="mt-4 border-t rule pt-3">
          <summary className="cursor-pointer text-sm text-base-content/60">
            List backups
          </summary>
          {(value?.connected || value?.needsReconnect || value?.loadError) && (
            <div className="flex flex-wrap gap-2 my-4">
              <button
                className="btn btn-sm"
                disabled={
                  action.isPending ||
                  !value?.connected ||
                  value?.backingUp ||
                  (value?.nextBackupAttemptAt ?? 0) > Date.now()
                }
                onClick={() => action.mutate({ kind: "backup" })}
              >
                {value?.backingUp ||
                (action.isPending && action.variables?.kind === "backup")
                  ? "Backing up…"
                  : "Back up AniList now"}
              </button>
              <button
                className="btn btn-sm"
                disabled={action.isPending || !value?.backupCount}
                onClick={() => action.mutate({ kind: "export" })}
              >
                Export latest AniList backup
              </button>
            </div>
          )}
          <label className="settings-row">
            <span>
              <span className="text-sm font-medium">
                Automatically back up AniList lists
              </span>
              <span className="block text-sm text-base-content/50 mt-1">
                Back up once a day while Vestra is open. Keep the seven latest
                encrypted snapshots per account. Disconnecting removes the token
                and keeps existing backups.
              </span>
            </span>
            <input
              aria-label="Automatically back up AniList lists"
              type="checkbox"
              role="switch"
              className="toggle toggle-primary"
              checked={settings.sources.anilistAutoBackup}
              onChange={(e) =>
                update({ sources: { anilistAutoBackup: e.target.checked } })
              }
            />
          </label>
          <p className="mt-3 text-sm text-base-content/60">
            Last successful backup: {date(value?.lastBackupAt)} ·{" "}
            {value?.backupCount ?? 0} saved
          </p>
          {value?.nextBackupAttemptAt && (
            <p className="text-sm">
              Next retry: {date(value.nextBackupAttemptAt)}
            </p>
          )}
        </details>
      )}
      {value?.lastBackupError && (
        <p role="alert" className="mt-2 text-sm text-warning">
          {value.lastBackupError}
        </p>
      )}
      {(action.error || status.error) && (
        <p role="alert" className="mt-2 text-sm text-error">
          {(action.error || status.error)?.message}
        </p>
      )}
      <p role="status" className="mt-2 text-sm">
        {notice}
      </p>
    </section>
  );
}
