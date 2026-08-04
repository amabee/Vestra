import { useMutation } from "@tanstack/react-query";
import { formatDuration } from "@vestra/core/format";
import {
  Loader2,
  Maximize,
  Pause,
  Play,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { bridge } from "@/lib/bridge";
import { usePlayer } from "@/lib/player-store";

/**
 * Player overlay.
 *
 * A plain `<video>` fed by `vestra-media://`, which the main process serves
 * with range support — that is what makes seeking work. There is no HTTP
 * server involved and the renderer never learns a filesystem path.
 *
 * Progress is written on an interval rather than on `timeupdate`: the latter
 * fires several times a second, and persisting that often would hammer the
 * JSON store for no benefit.
 */
export function PlayerOverlay() {
  const { item, source, close } = usePlayer();
  const videoRef = useRef<HTMLVideoElement>(null);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [waiting, setWaiting] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);

  // Mirrored so the unmount cleanup can persist a final position without
  // reading refs that have already been torn down.
  const latest = useRef({ position: 0, duration: 0 });
  latest.current = { position, duration };

  const saveProgress = useMutation({
    mutationFn: (input: { positionSeconds: number; durationSeconds: number }) =>
      bridge.progress.save({
        ref: item!,
        episodeId: null,
        ...input,
      }),
  });

  const persist = useCallback(() => {
    const { position: at, duration: total } = latest.current;
    if (!item || total <= 0 || at <= 0) return;
    saveProgress.mutate({ positionSeconds: at, durationSeconds: total });
  }, [item, saveProgress]);

  // Periodic save while playing, and one final save on close.
  useEffect(() => {
    if (!item) return;
    const timer = setInterval(persist, 15_000);
    return () => {
      clearInterval(timer);
      persist();
    };
  }, [item, persist]);

  useEffect(() => {
    if (!item) return;

    const onKey = (event: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;

      switch (event.key) {
        case "Escape":
          close();
          break;
        case " ":
          event.preventDefault();
          if (video.paused) void video.play();
          else video.pause();
          break;
        case "ArrowRight":
          video.currentTime += 10;
          break;
        case "ArrowLeft":
          video.currentTime -= 10;
          break;
        case "f":
          void videoRef.current?.requestFullscreen();
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, close]);

  if (!item || !source) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <header className="drag-region flex h-11 shrink-0 items-center gap-3 px-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-serif text-[15px]">{item.title}</p>
        </div>
        <span className="meta no-drag">{source.label ?? source.kind}</span>
        <button
          type="button"
          aria-label="Close player"
          onClick={close}
          className="no-drag grid size-8 place-items-center rounded-field text-base-content/60 transition-colors hover:bg-error hover:text-error-content"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="relative min-h-0 flex-1 bg-black">
        <video
          ref={videoRef}
          src={source.locator}
          autoPlay
          className="size-full"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onWaiting={() => setWaiting(true)}
          onPlaying={() => setWaiting(false)}
          onCanPlay={() => setWaiting(false)}
          onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
          onDurationChange={(event) => setDuration(event.currentTarget.duration)}
          onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
          onError={() =>
            setFailed(
              "This file could not be played. The codec may be unsupported by Chromium — " +
                "MKV with H.265 or AC-3 audio is the usual cause.",
            )
          }
        />

        {waiting && !failed ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <Loader2 className="size-8 animate-spin text-base-content/40" />
          </div>
        ) : null}

        {failed ? (
          <div className="absolute inset-0 grid place-items-center p-8">
            <div className="max-w-md text-center">
              <p className="font-serif text-display-sm">Cannot play this</p>
              <p className="mt-2 text-sm leading-relaxed text-base-content/55">{failed}</p>
            </div>
          </div>
        ) : null}
      </div>

      <footer className="shrink-0 space-y-2 px-4 py-3">
        <Scrubber
          position={position}
          duration={duration}
          onSeek={(seconds) => {
            if (videoRef.current) videoRef.current.currentTime = seconds;
          }}
        />

        <div className="flex items-center gap-3">
          <ControlButton
            label={playing ? "Pause" : "Play"}
            onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              if (video.paused) void video.play();
              else video.pause();
            }}
          >
            {playing ? (
              <Pause className="size-4 fill-current" />
            ) : (
              <Play className="size-4 fill-current" />
            )}
          </ControlButton>

          <ControlButton
            label={muted ? "Unmute" : "Mute"}
            onClick={() => {
              if (videoRef.current) videoRef.current.muted = !videoRef.current.muted;
            }}
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </ControlButton>

          <span className="meta tabular-nums">
            {formatDuration(Math.floor(position))} / {formatDuration(Math.floor(duration))}
          </span>

          <div className="flex-1" />

          <ControlButton
            label="Fullscreen"
            onClick={() => void videoRef.current?.requestFullscreen()}
          >
            <Maximize className="size-4" />
          </ControlButton>
        </div>
      </footer>
    </div>
  );
}

function Scrubber({
  position,
  duration,
  onSeek,
}: {
  position: number;
  duration: number;
  onSeek: (seconds: number) => void;
}) {
  const percent = duration > 0 ? (position / duration) * 100 : 0;

  return (
    <div
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.floor(duration)}
      aria-valuenow={Math.floor(position)}
      tabIndex={0}
      onClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const ratio = (event.clientX - bounds.left) / bounds.width;
        onSeek(ratio * duration);
      }}
      className="group h-4 cursor-pointer"
    >
      <div className="relative top-1.5 h-1 rounded-full bg-base-300">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={{ width: `${percent}%` }}
        />
        <div
          className="absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full bg-primary opacity-0 transition-opacity group-hover:opacity-100"
          style={{ left: `calc(${percent}% - 5px)` }}
        />
      </div>
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-field text-base-content/70 transition-colors hover:bg-base-300 hover:text-base-content"
    >
      {children}
    </button>
  );
}
