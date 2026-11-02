import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { bridge } from "@/lib/bridge";
export function TorrentConnection() {
  const client = useQueryClient();
  const config = useQuery({
    queryKey: ["torrent-configuration"],
    queryFn: bridge.torrents.configuration,
  });
  const [draft, setDraft] = useState<{
    url: string;
    username: string;
    password: string;
  } | null>(null);
  const value = draft ?? {
    url: config.data?.url ?? "http://localhost:8080",
    username: config.data?.username ?? "",
    password: "",
  };
  const save = useMutation({
    mutationFn: bridge.torrents.save,
    onSuccess: async () => {
      setDraft(null);
      test.reset();
      await client.invalidateQueries({ queryKey: ["torrent-configuration"] });
      await client.invalidateQueries({ queryKey: ["torrents"] });
    },
  });
  const test = useMutation({ mutationFn: bridge.torrents.test });
  return (
    <section className="settings-section">
      <h2 className="font-serif text-2xl">qBittorrent connection</h2>
      <p className="mt-2 max-w-xl text-sm text-base-content/55">
        Enable the Web User Interface in your qBittorrent app, then enter its
        address here. Save before testing.
      </p>
      <form
        className="mt-5 grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(value);
        }}
      >
        <fieldset
          disabled={save.isPending || config.isPending}
          className="grid gap-4 sm:grid-cols-2"
        >
          <label className="grid gap-2 text-sm sm:col-span-2">
            Web UI address
            <input
              type="url"
              required
              className="input w-full"
              value={value.url}
              onChange={(e) => setDraft({ ...value, url: e.target.value })}
            />
          </label>
          <label className="grid gap-2 text-sm">
            Username
            <input
              required
              autoComplete="off"
              className="input w-full"
              value={value.username}
              onChange={(e) => setDraft({ ...value, username: e.target.value })}
            />
          </label>
          <label className="grid gap-2 text-sm">
            Password
            <input
              type="password"
              autoComplete="new-password"
              className="input w-full"
              value={value.password}
              onChange={(e) => setDraft({ ...value, password: e.target.value })}
              placeholder={
                config.data?.saved
                  ? "Re-enter to replace the saved connection"
                  : "Web UI password"
              }
            />
          </label>
        </fieldset>
        <p className="text-xs text-base-content/45">
          Saved credentials are encrypted on this computer. Passwords are never
          returned to the interface.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn btn-primary btn-sm"
            disabled={
              save.isPending ||
              config.isPending ||
              !config.data?.encryptionAvailable ||
              (config.data?.saved && draft === null)
            }
          >
            {save.isPending ? "Saving…" : "Save connection"}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={
              !config.data?.configured ||
              test.isPending ||
              save.isPending ||
              draft !== null
            }
            onClick={() => test.mutate()}
          >
            {test.isPending ? "Testing…" : "Test connection"}
          </button>
          {config.data?.saved && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={save.isPending}
              onClick={() => save.mutate(null)}
            >
              Remove saved connection
            </button>
          )}
          <Link to="/downloads" className="btn btn-ghost btn-sm">
            Open downloads
          </Link>
        </div>
      </form>
      {config.isPending && (
        <p role="status" className="mt-3 text-sm">
          Reading connection…
        </p>
      )}
      {config.data && !config.data.encryptionAvailable && (
        <p role="alert" className="mt-3 text-sm text-warning">
          Secure storage is unavailable. Environment configuration can still be
          used.
        </p>
      )}
      {(config.error || config.data?.loadError) && (
        <p role="alert" className="mt-3 text-sm text-warning">
          Could not read the saved connection. Enter it again.
        </p>
      )}
      {save.error && (
        <p role="alert" className="mt-3 text-sm text-error">
          Could not save the connection. Check the address and secure storage.
        </p>
      )}
      {save.isSuccess && (
        <p role="status" className="mt-3 text-sm text-success">
          Connection settings saved.
        </p>
      )}
      {test.data && (
        <p
          role={test.data.connected ? "status" : "alert"}
          className="mt-3 text-sm"
        >
          {test.data.connected
            ? `Connected to qBittorrent ${test.data.version}.`
            : (test.data.error ??
              "Could not connect. Check the Web UI and credentials.")}
        </p>
      )}
      {test.error && (
        <p role="alert" className="mt-3 text-sm">
          Could not test the connection. Try again.
        </p>
      )}
    </section>
  );
}
