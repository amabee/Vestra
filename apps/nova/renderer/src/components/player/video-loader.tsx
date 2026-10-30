import "./video-loader.css";

/** Shared by the catalogue surface and the transparent window above native video. */
export function VideoLoader({ label }: { label: string }) {
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
      <div className="video-loader-track" aria-hidden="true">
        <span />
      </div>
    </div>
  );
}
