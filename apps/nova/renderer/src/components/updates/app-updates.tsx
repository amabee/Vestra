import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { ArrowDownToLine, RefreshCw, RotateCw } from "lucide-react";
import { bridge } from "@/lib/bridge";
import { SectionRule } from "@/components/layout/page";

const key = ["app-updates"];
function useAppUpdates() {
  const client = useQueryClient();
  useEffect(
    () => bridge.updates.onChanged((state) => client.setQueryData(key, state)),
    [client],
  );
  return useQuery({
    queryKey: key,
    queryFn: bridge.updates.state,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
export function UpdateIndicator() {
  const { data } = useAppUpdates();
  if (!data || !["available", "downloaded"].includes(data.phase)) return null;
  return (
    <Link
      to="/settings#app-updates"
      className="meta text-primary hover:underline"
      aria-live="polite"
    >
      {data.phase === "downloaded"
        ? "Update ready to install"
        : "Update available"}{" "}
      · {data.version}
    </Link>
  );
}
export function AppUpdatesPanel() {
  const client = useQueryClient();
  const query = useAppUpdates();
  const state = query.data;
  const command = useMutation({
    mutationFn: (action: "check" | "download" | "install") =>
      bridge.updates[action](),
    onSuccess: (state) => client.setQueryData(key, state),
  });
  const busy =
    command.isPending ||
    (!!state &&
      ["checking", "downloading", "installing"].includes(state.phase));
  const label = !state
    ? "Reading update status…"
    : {
        disabled: "Updates unavailable for this run",
        idle: "Ready to check",
        checking: "Checking for updates…",
        current: "You’re up to date",
        available: `Version ${state.version} is available`,
        downloading: `Downloading ${state.version}…`,
        downloaded: `Version ${state.version} is ready`,
        installing: "Restarting to install…",
        error: "Update needs attention",
      }[state.phase];
  return (
    <section id="app-updates" className="mt-10 scroll-mt-6">
      <SectionRule label="App updates" />
      <div className="mt-4 rounded-box border rule bg-base-200/30 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">
              Vestra Nova{" "}
              <span className="text-base-content/50">
                {state?.currentVersion ? `v${state.currentVersion}` : ""}
              </span>
            </h2>
            <p role="status" className="mt-1 text-sm">
              {label}
            </p>
            <p className="mt-2 text-sm text-base-content/60">
              Stable updates are checked automatically. You choose when to
              download and restart.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-sm btn-ghost"
              disabled={
                !state ||
                state.phase === "disabled" ||
                busy ||
                state.phase === "downloaded"
              }
              onClick={() => command.mutate("check")}
            >
              <RefreshCw
                className={`size-4 ${state?.phase === "checking" ? "animate-spin" : ""}`}
              />
              Check for updates
            </button>
            {(state?.phase === "available" ||
              (state?.phase === "error" && state.version)) && (
              <button
                className="btn btn-sm btn-primary"
                disabled={busy}
                onClick={() => command.mutate("download")}
              >
                <ArrowDownToLine className="size-4" />
                {state.phase === "error" ? "Retry download" : "Download update"}
              </button>
            )}
            {state?.phase === "downloaded" && (
              <button
                className="btn btn-sm btn-primary"
                disabled={busy}
                onClick={() => command.mutate("install")}
              >
                <RotateCw className="size-4" />
                Restart and install
              </button>
            )}
          </div>
        </div>
        {state?.progress && (
          <div className="mt-4">
            <progress
              className="progress progress-primary w-full"
              max={100}
              value={state.progress.percent}
              aria-label="Update download progress"
            />
            <p className="meta mt-1">
              {Math.round(state.progress.percent)}% ·{" "}
              {(state.progress.transferred / 1048576).toFixed(1)} /{" "}
              {(state.progress.total / 1048576).toFixed(1)} MB ·{" "}
              {(state.progress.bytesPerSecond / 1048576).toFixed(1)} MB/s
            </p>
          </div>
        )}
        {state?.message && (
          <p
            className={`mt-3 text-sm ${state.phase === "error" ? "text-error" : "text-base-content/60"}`}
            role={state.phase === "error" ? "alert" : undefined}
          >
            {state.message}
          </p>
        )}
        {(query.error || command.error) && (
          <p role="alert" className="mt-3 text-sm text-error">
            Update controls could not be reached. Restart the app and try again.
          </p>
        )}
        {state?.phase === "downloaded" && (
          <p className="mt-3 text-sm text-base-content/60">
            Restart when you’re ready. Playback and open readers will close.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/50">
          {state?.lastCheckedAt && (
            <span>
              Last checked {new Date(state.lastCheckedAt).toLocaleString()}
            </span>
          )}
          <button
            className="link"
            onClick={() =>
              void bridge.shell.openExternal(
                "https://github.com/amabee/Vestra/releases",
              )
            }
          >
            View releases
          </button>
        </div>
        {state?.releaseNotes && (
          <details className="mt-4 border-t rule pt-3 text-sm">
            <summary className="cursor-pointer text-base-content/70">
              What’s new
            </summary>
            <p className="mt-3 whitespace-pre-wrap break-words text-base-content/60">
              {state.releaseNotes}
            </p>
          </details>
        )}
      </div>
    </section>
  );
}
