"use client";

import { formatTimecode } from "@vestra/core/format";
import type { MediaRef } from "@vestra/types";
import { cn } from "@vestra/ui";
import {
  Maximize,
  Minimize,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/** How often playback position is persisted while playing. */
const PROGRESS_INTERVAL_MS = 10_000;

export interface VideoPlayerProps {
  src: string;
  mimeType?: string | null;
  title: string;
  /** Identifies the item for progress reporting. */
  mediaRef: MediaRef;
  episodeId?: string | null;
  /** Seconds to resume from. */
  startAt?: number;
  autoPlay?: boolean;
}

export function VideoPlayer({
  src,
  mimeType,
  title,
  mediaRef,
  episodeId = null,
  startAt = 0,
  autoPlay = true,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Latest position/duration, mirrored into a ref.
   * The unmount handler can't read `videoRef.current` — React may have already
   * detached the element by then — so it reads this instead.
   */
  const lastStateRef = useRef({ position: 0, duration: 0 });

  /** Persist position. `keepalive` lets the final write survive unmount. */
  const reportProgress = useCallback(
    (positionSeconds: number, totalSeconds: number, keepalive = false) => {
      if (totalSeconds <= 0) return;

      void fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ref: mediaRef,
          episodeId,
          positionSeconds,
          durationSeconds: totalSeconds,
        }),
        keepalive,
      }).catch(() => undefined);
    },
    [episodeId, mediaRef],
  );

  // Periodic save while playing.
  useEffect(() => {
    if (!playing) return;

    const timer = setInterval(() => {
      const video = videoRef.current;
      if (video && video.duration > 0) {
        reportProgress(video.currentTime, video.duration);
      }
    }, PROGRESS_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [playing, reportProgress]);

  // Final save when the player goes away.
  useEffect(() => {
    return () => {
      const { position, duration: total } = lastStateRef.current;
      if (total > 0 && position > 0) {
        reportProgress(position, total, true);
      }
    };
  }, [reportProgress]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, []);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(
      Math.max(0, video.currentTime + delta),
      video.duration || 0,
    );
  }, []);

  const toggleFullscreen = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;

    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void node.requestFullscreen().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Keyboard shortcuts, scoped to the player container.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Don't hijack typing.
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;

      switch (event.key) {
        case " ":
        case "k":
          event.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          event.preventDefault();
          seekBy(10);
          break;
        case "ArrowLeft":
          event.preventDefault();
          seekBy(-10);
          break;
        case "f":
          event.preventDefault();
          toggleFullscreen();
          break;
        case "m": {
          event.preventDefault();
          const video = videoRef.current;
          if (video) {
            video.muted = !video.muted;
            setMuted(video.muted);
          }
          break;
        }
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [seekBy, toggleFullscreen, togglePlay]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    // Auto-hide only while playing, so a paused player stays usable.
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setControlsVisible(false);
    }, 2500);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const progressPercent = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      onMouseMove={showControls}
      onClick={showControls}
      className="group/player relative aspect-video w-full overflow-hidden rounded-xl bg-black"
    >
      <video
        ref={videoRef}
        className="size-full"
        autoPlay={autoPlay}
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          setDuration(video.duration);
          lastStateRef.current.duration = video.duration;
          if (startAt > 0 && startAt < video.duration) video.currentTime = startAt;
        }}
        onTimeUpdate={(event) => {
          const video = event.currentTarget;
          setCurrent(video.currentTime);
          lastStateRef.current = {
            position: video.currentTime,
            duration: video.duration,
          };
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          setControlsVisible(true);
          const video = videoRef.current;
          if (video && video.duration > 0) reportProgress(video.currentTime, video.duration);
        }}
        onVolumeChange={(event) => {
          setVolume(event.currentTarget.volume);
          setMuted(event.currentTarget.muted);
        }}
      >
        <source src={src} {...(mimeType ? { type: mimeType } : {})} />
        Your browser does not support this video format.
      </video>

      <div
        className={cn(
          "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 pt-10",
          "transition-opacity duration-200",
          controlsVisible ? "opacity-100" : "opacity-0",
        )}
      >
        <p className="mb-2 truncate text-[13px] font-medium text-white/90">{title}</p>

        {/* Scrub bar */}
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={current}
          aria-label="Seek"
          onChange={(event) => {
            const video = videoRef.current;
            if (video) video.currentTime = Number(event.target.value);
          }}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/25 accent-violet-500"
          style={{
            background: `linear-gradient(to right, var(--violet) ${progressPercent}%, oklch(1 0 0 / 0.25) ${progressPercent}%)`,
          }}
        />

        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? "Pause" : "Play"}
            className="flex size-8 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/15"
          >
            {playing ? (
              <Pause className="size-4 fill-current" />
            ) : (
              <Play className="size-4 fill-current" />
            )}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={muted ? "Unmute" : "Mute"}
              onClick={() => {
                const video = videoRef.current;
                if (video) {
                  video.muted = !video.muted;
                  setMuted(video.muted);
                }
              }}
              className="flex size-8 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/15"
            >
              {muted || volume === 0 ? (
                <VolumeX className="size-4" />
              ) : (
                <Volume2 className="size-4" />
              )}
            </button>

            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label="Volume"
              onChange={(event) => {
                const video = videoRef.current;
                if (!video) return;
                video.volume = Number(event.target.value);
                video.muted = video.volume === 0;
              }}
              className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-white/25 accent-violet-500"
            />
          </div>

          <span className="ml-auto font-mono text-[11px] tabular-nums text-white/80">
            {formatTimecode(current)} / {formatTimecode(duration)}
          </span>

          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            className="flex size-8 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/15"
          >
            {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
