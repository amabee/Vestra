import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pause, Play } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Page, PageHeader, Notice } from "@/components/layout/page";
import { bridge } from "@/lib/bridge";
import { useSettings } from "@/lib/queries";
const bytes = (value: number) =>
  value < 1048576
    ? `${(value / 1024).toFixed(1)} KB`
    : value < 1073741824
      ? `${(value / 1048576).toFixed(1)} MB`
      : `${(value / 1073741824).toFixed(1)} GB`;
export function DownloadsRoute() {
  const { data: settings } = useSettings();
  const cache = useQueryClient();
  const [urls, setUrls] = useState("");
  const [adding, setAdding] = useState(false);
  const enabled = settings?.downloads.qbittorrentEnabled === true;
  const transfers = useQuery({
    queryKey: ["torrents", settings?.downloads.category],
    queryFn: bridge.torrents.list,
    enabled,
    refetchInterval: enabled
      ? (settings?.downloads.pollIntervalMs ?? 3000)
      : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => cache.invalidateQueries({ queryKey: ["torrents"] }),
  });
  const add = useMutation({
    mutationFn: bridge.torrents.add,
    onSuccess: () => {
      setUrls("");
      setAdding(false);
      void cache.invalidateQueries({ queryKey: ["torrents"] });
    },
  });
  return (
    <Page>
      <PageHeader
        title="Downloads"
        lead="Your transfers, managed through qBittorrent."
        actions={
          <Link
            className="btn btn-ghost btn-sm"
            to="/settings?section=torrents"
          >
            Connection settings
          </Link>
        }
      />
      {!enabled ? (
        <Notice
          title="Connect your torrent client"
          body="Enable qBittorrent in Settings to add magnets and manage downloads."
        />
      ) : (
        <>
          <div className="my-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-base-content/50">
              Category: {settings?.downloads.category}
            </p>
            <div className="flex gap-2">
              <button
                className="btn btn-ghost btn-sm"
                disabled={transfers.isFetching}
                onClick={() => void transfers.refetch()}
              >
                Refresh
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setAdding(!adding)}
              >
                <Download className="size-4" />
                Add transfer
              </button>
            </div>
          </div>
          {adding && (
            <form
              className="mb-6 grid gap-3 rounded-box border rule p-5"
              onSubmit={(event) => {
                event.preventDefault();
                add.mutate(
                  urls
                    .split(/\r?\n/)
                    .map((v) => v.trim())
                    .filter(Boolean),
                );
              }}
            >
              <label className="grid gap-2 text-sm">
                Magnet links or torrent URLs
                <textarea
                  className="textarea min-h-24 w-full"
                  required
                  value={urls}
                  onChange={(event) => setUrls(event.target.value)}
                  placeholder="One magnet or http(s) torrent URL per line"
                />
              </label>
              <div className="flex gap-2">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={add.isPending || !urls.trim()}
                >
                  {add.isPending ? "Adding…" : "Add to qBittorrent"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={add.isPending}
                  onClick={() => setAdding(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {(transfers.error || action.error || add.error) && (
            <p role="alert" className="my-5 text-sm text-error">
              The torrent client could not complete this request. Check the
              connection in Settings and try again.
            </p>
          )}
          {transfers.isPending && (
            <p role="status">Connecting to qBittorrent…</p>
          )}
          {transfers.data?.length === 0 && (
            <Notice
              title="No transfers yet"
              body="Add a magnet or torrent URL to start a download."
            />
          )}
          <div className="divide-y divide-base-content/10">
            {transfers.data?.map((torrent) => (
              <article key={torrent.hash} className="py-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="break-words text-base font-medium">
                      {torrent.name}
                    </h2>
                    <p className="mt-1 text-sm text-base-content/50">
                      {torrent.state}, {bytes(torrent.downloadedBytes)} of{" "}
                      {bytes(torrent.sizeBytes)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm shrink-0"
                    aria-label={`${torrent.state === "paused" ? "Resume" : "Pause"} ${torrent.name}`}
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate(() =>
                        torrent.state === "paused"
                          ? bridge.torrents.resume(torrent.hash)
                          : bridge.torrents.pause(torrent.hash),
                      )
                    }
                  >
                    {torrent.state === "paused" ? (
                      <Play className="size-4" />
                    ) : (
                      <Pause className="size-4" />
                    )}
                  </button>
                </div>
                <progress
                  className="progress progress-primary mt-4 w-full"
                  aria-label={`${torrent.name} download progress`}
                  value={torrent.progress}
                  max={1}
                />
                <div className="mt-2 flex justify-between text-xs text-base-content/50">
                  <span>{Math.round(torrent.progress * 100)}%</span>
                  <span>
                    {bytes(torrent.downloadSpeed)}/s down,{" "}
                    {bytes(torrent.uploadSpeed)}/s up
                  </span>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </Page>
  );
}
