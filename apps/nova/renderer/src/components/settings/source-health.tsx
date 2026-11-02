import { Link } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  CircleOff,
  Copy,
} from "lucide-react";
import { bridge } from "@/lib/bridge";
import {
  PlaybackFailure,
  playbackIssue,
} from "../../../../shared/playback-errors";
function newerStable(current: string, candidate: string): boolean {
  const parse = (value: string) =>
    /^(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})$/.test(value)
      ? value.split(".").map(Number)
      : null;
  const a = parse(current),
    b = parse(candidate);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return b[i]! > a[i]!;
  }
  return false;
}
export function SourceHealthPanel() {
  const updates = useMutation({
    mutationFn: async () => {
      const [installed, catalogue] = await Promise.all([
        bridge.extensions.installed(),
        bridge.extensions.browse(),
      ]);
      const found: Record<string, string> = {};
      for (const record of installed) {
        const candidates = catalogue.entries.filter(
          (entry) =>
            entry.id === record.id && entry.registryUrl === record.registryUrl,
        );
        for (const candidate of candidates)
          if (
            newerStable(
              found[`ext-${record.id}`] ?? record.version,
              candidate.version,
            )
          )
            found[`ext-${record.id}`] = candidate.version;
      }
      return { versions: found, partial: catalogue.errors.length > 0 };
    },
  });
  const health = useQuery({
    queryKey: ["source-health"],
    queryFn: bridge.app.sourceHealth,
    staleTime: 15000,
  });
  return (
    <section aria-label="Source health" className="settings-section">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-serif text-2xl">Source health</h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={health.isFetching}
          onClick={() => void health.refetch()}
        >
          <RefreshCw className="size-4" />
          Refresh
        </button>
      </div>
      <p className="mt-2 text-sm text-base-content/55">
        Runtime availability and the latest stream resolution in this session. A
        loaded extension has not necessarily played a video.
      </p>
      {health.isPending && (
        <p role="status" className="py-6">
          Reading extension status…
        </p>
      )}
      {health.error && (
        <p role="alert" className="py-6">
          Could not read extension status. Try refreshing.
        </p>
      )}
      {health.data?.length === 0 && (
        <p className="py-6 text-sm text-base-content/60">
          No extensions installed yet.
        </p>
      )}
      <div className="mt-4 divide-y divide-base-content/10">
        {health.data?.map((row) => {
          const failed = row.observation?.state === "failed";
          const Icon = !row.enabled
            ? CircleOff
            : !row.loaded || failed || row.needsReview
              ? AlertTriangle
              : CheckCircle2;
          return (
            <div
              key={row.id}
              className="flex flex-wrap items-start justify-between gap-3 py-4"
            >
              <div className="flex min-w-0 gap-3">
                <Icon
                  className={`mt-1 size-4 shrink-0 ${!row.enabled ? "text-base-content/35" : failed || !row.loaded || row.needsReview ? "text-warning" : "text-success"}`}
                />
                <div>
                  <p className="font-medium">{row.name}</p>
                  <p className="mt-1 text-xs text-base-content/50">
                    {row.kind === "compatibility"
                      ? "Compatibility import"
                      : row.kind === "service"
                        ? "Service connection"
                        : "Vestra extension"}
                    {row.version ? `, version ${row.version}` : ""}
                  </p>
                  {row.observation && (
                    <p className="mt-2 max-w-lg text-sm text-base-content/60">
                      {failed
                        ? playbackIssue(
                            new PlaybackFailure(
                              row.observation.code ?? "unknown",
                            ),
                          ).message
                        : "Stream resolved successfully."}{" "}
                      <span className="text-xs">
                        {new Date(row.observation.at).toLocaleTimeString()}
                      </span>
                    </p>
                  )}
                </div>
              </div>
              <span className="rounded-field border rule px-2.5 py-1 text-xs">
                {!row.enabled
                  ? "Disabled"
                  : !row.loaded
                    ? "Unavailable"
                    : updates.data?.versions[row.id]
                      ? `Update ${updates.data.versions[row.id]} available`
                      : row.needsReview
                        ? "Needs review"
                        : failed
                          ? "Last stream failed"
                          : "Runtime loaded"}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          className="btn btn-sm"
          disabled={updates.isPending}
          onClick={() => updates.mutate()}
        >
          {updates.isPending
            ? "Checking registries…"
            : "Check extension updates"}
        </button>
        <Link className="text-sm text-primary underline" to="/extensions">
          Manage extensions
        </Link>
      </div>
      {updates.error && (
        <p role="alert" className="mt-3 text-sm">
          Could not check extension updates. Try again.
        </p>
      )}
      {updates.data && (
        <p role="status" className="mt-3 text-sm text-base-content/60">
          {Object.keys(updates.data.versions).length
            ? "New versions are available. Review updates in Extensions."
            : "No newer stable versions found for matching native registry listings."}
          {updates.data.partial ? " Some registries could not be reached." : ""}
        </p>
      )}
      <p className="mt-3 text-xs text-base-content/45">
        Compatibility imports have their own update review in Extensions. Stream
        results describe extraction, not continuous video delivery.
      </p>
    </section>
  );
}
export function PlaybackDiagnosticsPanel() {
  const events = useQuery({
    queryKey: ["playback-diagnostics"],
    queryFn: bridge.app.playbackDiagnostics,
    staleTime: 0,
  });
  const copy = useMutation({ mutationFn: bridge.app.copyPlaybackDiagnostics });
  return (
    <section className="settings-section" aria-label="Playback diagnostics">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-2xl">Playback diagnostics</h2>
        <div className="flex gap-2">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => void events.refetch()}
            disabled={events.isFetching}
          >
            Refresh
          </button>
          <button
            className="btn btn-sm"
            disabled={copy.isPending || !events.data?.length}
            onClick={() => copy.mutate()}
          >
            <Copy className="size-4" />
            Copy report
          </button>
        </div>
      </div>
      <p className="mt-2 text-sm text-base-content/55">
        The latest 50 failures, kept only until Vestra closes. Video URLs, local
        paths and common credential fields are redacted.
      </p>
      {copy.isSuccess && (
        <p role="status" className="mt-3 text-sm text-success">
          Report copied. Review it before sharing.
        </p>
      )}
      {(copy.error || events.error) && (
        <p role="alert" className="mt-3 text-sm text-error">
          Could not read or copy the report. Try again.
        </p>
      )}
      {events.isPending && (
        <p role="status" className="py-6">
          Loading diagnostics…
        </p>
      )}
      {events.data?.length === 0 && (
        <p className="py-6 text-sm text-base-content/60">
          No playback failures recorded in this session.
        </p>
      )}
      {events.data?.map((row) => (
        <details key={row.id} className="border-b rule py-3">
          <summary className="cursor-pointer text-sm">
            {new Date(row.at).toLocaleTimeString()} — {row.stage}: {row.code}
          </summary>
          <p
            className="mt-3 break-words text-sm text-base-content/60"
            data-selectable
          >
            {row.detail}
          </p>
        </details>
      ))}
    </section>
  );
}
