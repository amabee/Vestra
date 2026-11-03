import { useRef, useState } from "react";
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
  const status = useQuery({
    queryKey: accountKey,
    queryFn: bridge.anilistAccount.status,
    refetchInterval: (query) => (query.state.data?.backingUp ? 2000 : 30000),
    retry: false,
  });
  const pendingToken = useRef("");
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState(settings.sources.anilistClientId);
  const [notice, setNotice] = useState("");
  const action = useMutation({
    mutationFn: async (value: {
      kind: "connect" | "disconnect" | "backup" | "export" | "authorize";
    }) => {
      setNotice("");
      if (value.kind === "connect") {
        const submitted = pendingToken.current;
        pendingToken.current = "";
        return bridge.anilistAccount.connect(submitted);
      }
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
      await bridge.anilistAccount.authorize(clientId);
      update({ sources: { anilistClientId: clientId } });
      setNotice(
        "Approve access in your browser, then paste the access token below.",
      );
    },
    onSettled: () => cache.invalidateQueries({ queryKey: accountKey }),
  });
  if (!matches) return null;
  const value = status.data;
  return (
    <section className="settings-section" data-settings-search-match={matches}>
      <h3 className="font-serif text-2xl">Local account & AniList</h3>
      <p className="my-3 text-sm text-base-content/60">
        Your Vestra library stays local. Connect AniList to keep encrypted
        copies of your anime and manga lists. This connection does not change
        your AniList lists.
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
        <div className="mt-4 grid gap-3 max-w-xl">
          <details>
            <summary className="cursor-pointer text-sm">
              Authorize Vestra in your browser
            </summary>
            <p className="my-3 text-sm text-base-content/60">
              Use your public AniList application client ID. In{" "}
              <a
                className="link"
                href="https://anilist.co/settings/developer"
                target="_blank"
                rel="noreferrer"
              >
                AniList developer settings
              </a>
              , set its redirect URL to{" "}
              <code className="break-all">
                https://anilist.co/api/v2/oauth/pin
              </code>
              . Never enter a client secret here.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                className="input"
                aria-label="AniList client ID"
                inputMode="numeric"
                maxLength={12}
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
              <button
                className="btn btn-sm"
                disabled={action.isPending || !/^[1-9]\d{0,11}$/.test(clientId)}
                onClick={() => action.mutate({ kind: "authorize" })}
              >
                Authorize with AniList
              </button>
            </div>
          </details>
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              pendingToken.current = token;
              setToken("");
              action.mutate({ kind: "connect" });
            }}
          >
            <label className="grid gap-2 text-sm">
              AniList access token
              <input
                aria-label="AniList access token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                maxLength={8192}
                className="input w-full"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={action.isPending || !value?.encryptionAvailable}
              />
            </label>
            <p className="text-xs text-base-content/50">
              The token is verified with AniList and encrypted on this computer.
              It is never returned to this page or shared with extensions.
            </p>
            <button
              className="btn btn-primary btn-sm justify-self-start"
              disabled={
                action.isPending || !value?.encryptionAvailable || !token.trim()
              }
            >
              Connect AniList
            </button>
          </form>
        </div>
      )}
      {value && !value.encryptionAvailable && (
        <p role="alert" className="mt-3 text-error text-sm">
          Secure storage is unavailable. Account connection and backups are
          disabled.
        </p>
      )}
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
          <button
            className="btn btn-ghost btn-sm"
            disabled={action.isPending}
            onClick={() => {
              setToken("");
              action.mutate({ kind: "disconnect" });
            }}
          >
            Disconnect AniList
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
            encrypted snapshots per account. Disconnecting removes the token and
            keeps existing backups.
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
        <p className="text-sm">Next retry: {date(value.nextBackupAttemptAt)}</p>
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
