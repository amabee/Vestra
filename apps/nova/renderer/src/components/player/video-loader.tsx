import "./video-loader.css";

/** Shared by the catalogue surface and the transparent window above native video. */
export function VideoLoader({
  label,
  bufferedSeconds,
  downloadBytesPerSecond,
}: {
  label: string;
  bufferedSeconds?: number | null;
  downloadBytesPerSecond?: number | null;
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
    <div className="video-loader" role="status" aria-live="polite">
      <div className="video-loader-orbit" aria-hidden="true">
        <span />
        <span />
        <span />
        <svg viewBox="0 0 48 48">
          <path d="M19 14 35 24 19 34Z" />
        </svg>
      </div>
      <p>
        {label}
        <span aria-hidden="true">…</span>
      </p>
      {health && (
        <p className="video-loader-health" aria-live="off">
          {health}
        </p>
      )}
      <div className="video-loader-track" aria-hidden="true">
        <span />
      </div>
    </div>
  );
}
