import "./video-loader.css";

/** Shared by the catalogue surface and the transparent window above native video. */
export function VideoLoader({
  label,
  bufferedSeconds,
  downloadBytesPerSecond,
  buffering = false,
  title,
  episodeLabel,
}: {
  label: string;
  bufferedSeconds?: number | null;
  downloadBytesPerSecond?: number | null;
  buffering?: boolean;
  title?: string;
  episodeLabel?: string | null;
}) {
  const health = [
    typeof bufferedSeconds === "number" &&
    Number.isFinite(bufferedSeconds) &&
    bufferedSeconds >= 0
      ? `${bufferedSeconds.toFixed(1)}s buffered`
      : null,
    typeof downloadBytesPerSecond === "number" &&
    Number.isFinite(downloadBytesPerSecond) &&
    downloadBytesPerSecond >= 0
      ? `Read ${(downloadBytesPerSecond / 1048576).toFixed(2)} MiB/s`
      : null,
  ]
    .filter(Boolean)
    .join(" / ");
  return (
    <div
      className={`video-loader ${buffering ? "video-loader--buffering" : "video-loader--opening"}`}
    >
      <div className="video-loader-card">
        <div className="video-loader-eyebrow" aria-hidden="true">
          <span>Vestra</span>
          <span className="video-loader-signal">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>{buffering ? "Resuming playback" : "Now showing"}</span>
        </div>
        <div className="video-loader-projector" aria-hidden="true">
          <span className="video-loader-frame" />
          <span className="video-loader-frame" />
          <div className="video-loader-gate">
            <span className="video-loader-perforations" />
            <svg viewBox="0 0 48 48">
              <path d="M19 14 35 24 19 34Z" />
            </svg>
            <span className="video-loader-perforations" />
          </div>
        </div>
        <div
          className="video-loader-copy"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <h2>
            {label}
            <span aria-hidden="true">…</span>
          </h2>
          {title && (
            <p className="video-loader-title">
              {title}
              {episodeLabel ? <span> · {episodeLabel}</span> : null}
            </p>
          )}
          <p className="video-loader-hint">
            {buffering
              ? "Your episode will resume automatically."
              : "Settle in. Your episode is on its way."}
          </p>
        </div>
        <div className="video-loader-track" aria-hidden="true">
          <span />
        </div>
        {health && (
          <p className="video-loader-health" aria-live="off">
            {health}
          </p>
        )}
      </div>
    </div>
  );
}
