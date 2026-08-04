import { useCallback, useEffect, useRef, useState } from "react";

import {
  bridge,
  type MpvState,
  type NowPlaying,
  type PlayerCommand,
} from "@/lib/bridge";

import {
  BackIcon,
  CloseIcon,
  ExitFullscreenIcon,
  ForwardIcon,
  FullscreenIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  RewindIcon,
  SubtitlesIcon,
  SubtitlesOffIcon,
  SkipSegmentIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  VolumeMutedIcon,
} from "./icons";
import { PlayerSettingsIcon } from "./icons-settings";
import { SettingsMenu } from "./settings-menu";

/**
 * The player's floating controls.
 *
 * Rendered in a transparent window above mpv's video surface, which is what
 * lets them sit over the picture and fade away — the video is never resized to
 * make room for them.
 *
 * The window spans the whole video, so pointer events are handed back to the
 * system whenever nothing here wants them. Otherwise the overlay would swallow
 * every click meant for the window beneath.
 */

const EMPTY: MpvState = {
  running: false,
  idle: true,
  paused: true,
  position: 0,
  duration: 0,
  volume: 1,
  muted: false,
  speed: 1,
  subtitleDelay: 0,
  subtitleScale: 1,
  ended: false,
  tracks: [],
  subtitleVisible: true,
  error: null,
};

const HIDE_AFTER_MS = 2600;

export function PlayerChrome() {
  const [mpv, setMpv] = useState<MpvState>(EMPTY);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [visible, setVisible] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---------------------------------------------------------------------- *
   * State in
   * ---------------------------------------------------------------------- */

  useEffect(() => {
    const stop = bridge.mpv.onState(setMpv);
    void bridge.mpv.subscribe().then(setMpv).catch(() => undefined);
    return stop;
  }, []);

  useEffect(() => {
    const stop = bridge.player.onNowPlaying(setNowPlaying);
    void bridge.player.getNowPlaying().then(setNowPlaying).catch(() => undefined);
    return stop;
  }, []);

  useEffect(() => {
    void bridge.window.isFullscreen().then(setFullscreen).catch(() => undefined);
  }, [nowPlaying]);

  /* ---------------------------------------------------------------------- *
   * Showing and hiding
   * ---------------------------------------------------------------------- */

  const wake = useCallback(() => {
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), HIDE_AFTER_MS);
  }, []);

  // While a menu is open, or playback is paused, the controls stay put.
  useEffect(() => {
    if (menuOpen || mpv.paused || scrubbing) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setVisible(true);
      return;
    }
    wake();
  }, [menuOpen, mpv.paused, scrubbing, wake]);

  useEffect(() => {
    const onMove = () => wake();
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [wake]);

  /**
   * Only take the pointer when something is on screen to click.
   *
   * The overlay covers the entire video, so leaving it interactive while
   * hidden would block the window underneath entirely. `forward: true` keeps
   * movement events coming through so the controls can still be woken.
   */
  useEffect(() => {
    void bridge.player.setInteractive(visible || menuOpen).catch(() => undefined);
  }, [visible, menuOpen]);

  /* ---------------------------------------------------------------------- *
   * Actions
   * ---------------------------------------------------------------------- */

  const send = (command: PlayerCommand) => {
    void bridge.player.send(command).catch(() => undefined);
  };

  const togglePlay = () => {
    void (mpv.paused ? bridge.mpv.play() : bridge.mpv.pause()).catch(() => undefined);
  };

  const seek = (seconds: number) => {
    void bridge.mpv.seek(Math.max(0, seconds)).catch(() => undefined);
  };

  const toggleFullscreen = () => {
    void bridge.window
      .setFullscreen(!fullscreen)
      .then(setFullscreen)
      .catch(() => undefined);
  };

  const subtitles = mpv.tracks.filter((track) => track.type === "sub");
  const subtitlesOn = mpv.subtitleVisible && subtitles.some((track) => track.selected);

  const toggleSubtitles = () => {
    void (async () => {
      if (subtitlesOn) {
        await bridge.mpv.setSubtitleVisible(false);
        return;
      }
      const chosen = subtitles.find((track) => track.selected) ?? subtitles[0];
      if (chosen) await bridge.mpv.selectTrack("sub", chosen.id);
      await bridge.mpv.setSubtitleVisible(true);
    })().catch(() => undefined);
  };

  const hasPrevious = (nowPlaying?.index ?? 0) > 0;
  const hasNext = (nowPlaying?.index ?? 0) + 1 < (nowPlaying?.total ?? 0);

  /* ---------------------------------------------------------------------- *
   * Skipping openings and endings
   * ---------------------------------------------------------------------- */

  const activeSkip = (nowPlaying?.skips ?? []).find(
    (skip) =>
      mpv.position >= skip.startSeconds && mpv.position < skip.endSeconds - 1,
  );

  /**
   * Auto-skip, once per range.
   *
   * The guard matters: without it, seeking back into an opening would be
   * undone immediately and the viewer could never rewatch it.
   */
  const skippedRanges = useRef(new Set<string>());

  useEffect(() => {
    if (!nowPlaying?.autoSkip || !activeSkip) return;

    const key = `${activeSkip.kind}:${activeSkip.startSeconds}`;
    if (skippedRanges.current.has(key)) return;

    skippedRanges.current.add(key);
    void bridge.mpv.seek(activeSkip.endSeconds).catch(() => undefined);
  }, [nowPlaying?.autoSkip, activeSkip]);

  // A new episode gets a clean slate.
  useEffect(() => {
    skippedRanges.current.clear();
  }, [nowPlaying?.index, nowPlaying?.title]);

  const shown = visible || menuOpen;

  return (
    <div
      className="relative h-full w-full select-none"
      onDoubleClick={toggleFullscreen}
    >
      {/* Skip sits outside the fading chrome: it is offered for a fixed window
          of the episode and should not vanish with the controls. */}
      {activeSkip && !nowPlaying?.autoSkip ? (
        <button
          type="button"
          onClick={() => {
            void bridge.mpv.seek(activeSkip.endSeconds).catch(() => undefined);
          }}
          className="meta absolute bottom-28 right-6 z-10 flex items-center gap-2 rounded-field border border-white/25 bg-black/70 px-4 py-2.5 text-white backdrop-blur transition-colors hover:bg-primary hover:text-primary-content"
        >
          <SkipSegmentIcon className="size-4" />
          Skip {activeSkip.kind}
        </button>
      ) : null}

      <div
        className={`h-full w-full transition-opacity duration-200 ${
          shown ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {/* Scrims rather than panels: the video stays visible through them. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/85 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/90 via-black/60 to-transparent" />

      <header className="absolute inset-x-0 top-0 flex h-14 items-center gap-2 px-3">
        <IconButton label="Back" onClick={() => send("close")}>
          <BackIcon className="size-4" />
        </IconButton>

        <p className="pointer-events-none absolute inset-x-0 truncate px-16 text-center font-serif text-[15px] leading-tight text-white">
          {nowPlaying?.title ?? ""}
          {nowPlaying?.episodeLabel ? (
            <span className="text-white/55"> — {nowPlaying.episodeLabel}</span>
          ) : null}
        </p>

        <div className="flex-1" />

        <IconButton label="Close player" onClick={() => send("close")} danger>
          <CloseIcon className="size-4" />
        </IconButton>
      </header>

      <footer className="absolute inset-x-0 bottom-0 space-y-1 px-4 pb-3">
        <Scrubber
          position={mpv.position}
          duration={mpv.duration}
          onSeek={seek}
          onScrubbing={setScrubbing}
        />

        <div className="flex items-center gap-1">
          <IconButton
            label="Previous episode"
            onClick={() => send("previous")}
            disabled={!hasPrevious}
          >
            <PreviousIcon className="size-4" />
          </IconButton>

          <IconButton label={mpv.paused ? "Play" : "Pause"} onClick={togglePlay}>
            {mpv.paused ? <PlayIcon className="size-5" /> : <PauseIcon className="size-5" />}
          </IconButton>

          <IconButton
            label="Next episode"
            onClick={() => send("next")}
            disabled={!hasNext}
          >
            <NextIcon className="size-4" />
          </IconButton>

          <IconButton label="Back 10 seconds" onClick={() => seek(mpv.position - 10)}>
            <RewindIcon className="size-4" />
          </IconButton>

          <IconButton label="Forward 10 seconds" onClick={() => seek(mpv.position + 10)}>
            <ForwardIcon className="size-4" />
          </IconButton>

          <div className="group/vol ml-1 flex items-center gap-1">
            <IconButton
              label={mpv.muted ? "Unmute" : "Mute"}
              onClick={() => {
                void bridge.mpv.setMuted(!mpv.muted).catch(() => undefined);
              }}
            >
              {mpv.muted || mpv.volume === 0 ? (
                <VolumeMutedIcon className="size-4" />
              ) : mpv.volume < 0.5 ? (
                <VolumeLowIcon className="size-4" />
              ) : (
                <VolumeHighIcon className="size-4" />
              )}
            </IconButton>

            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.05}
              value={mpv.muted ? 0 : mpv.volume}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                void bridge.mpv.setVolume(value).catch(() => undefined);
                if (value > 0 && mpv.muted) {
                  void bridge.mpv.setMuted(false).catch(() => undefined);
                }
              }}
              className="h-1 w-0 cursor-pointer appearance-none rounded-full bg-white/30 opacity-0 transition-all duration-200 group-hover/vol:w-20 group-hover/vol:opacity-100 [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
            />
          </div>

          <span className="index-mark ml-2 text-white/70 tabular-nums">
            {formatTime(mpv.position)} / {formatTime(mpv.duration)}
          </span>

          <div className="flex-1" />

          <IconButton
            label={subtitlesOn ? "Hide subtitles" : "Show subtitles"}
            onClick={toggleSubtitles}
            active={subtitlesOn}
            disabled={subtitles.length === 0}
          >
            {subtitlesOn ? (
              <SubtitlesIcon className="size-4" />
            ) : (
              <SubtitlesOffIcon className="size-4" />
            )}
          </IconButton>

          {/* Anchored to its button and drawn over the video, which is the
              whole point of this window existing. */}
          <div className="relative">
            <IconButton
              label="Settings"
              onClick={() => setMenuOpen((open) => !open)}
              active={menuOpen}
            >
              <PlayerSettingsIcon className="size-4" />
            </IconButton>

            {menuOpen ? (
              <SettingsMenu mpv={mpv} onClose={() => setMenuOpen(false)} />
            ) : null}
          </div>

          <IconButton
            label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            onClick={toggleFullscreen}
          >
            {fullscreen ? (
              <ExitFullscreenIcon className="size-4" />
            ) : (
              <FullscreenIcon className="size-4" />
            )}
          </IconButton>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* =============================================================================
 * Pieces
 * ========================================================================== */

function IconButton({
  label,
  onClick,
  children,
  active = false,
  disabled = false,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`grid size-9 shrink-0 place-items-center rounded-field transition-colors disabled:pointer-events-none disabled:opacity-25 ${
        danger ? "hover:bg-error hover:text-error-content" : "hover:bg-white/15"
      } ${active ? "text-white" : "text-white/75"}`}
    >
      {children}
    </button>
  );
}

function Scrubber({
  position,
  duration,
  onSeek,
  onScrubbing,
}: {
  position: number;
  duration: number;
  onSeek: (seconds: number) => void;
  onScrubbing: (value: boolean) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const positionFrom = (clientX: number): number => {
    const bounds = track.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0) return 0;
    const ratio = (clientX - bounds.left) / bounds.width;
    return Math.max(0, Math.min(1, ratio)) * duration;
  };

  const percent = duration > 0 ? (position / duration) * 100 : 0;

  return (
    <div className="group/bar relative py-2">
      <div
        ref={track}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.floor(duration)}
        aria-valuenow={Math.floor(position)}
        tabIndex={0}
        className="relative h-1 cursor-pointer rounded-full bg-white/25 transition-[height] group-hover/bar:h-1.5"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          onScrubbing(true);
          onSeek(positionFrom(event.clientX));
        }}
        onPointerMove={(event) => {
          setHover(positionFrom(event.clientX));
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            onSeek(positionFrom(event.clientX));
          }
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          onScrubbing(false);
        }}
        onPointerLeave={() => setHover(null)}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={{ width: `${percent}%` }}
        />
        <div
          className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-primary opacity-0 transition-opacity group-hover/bar:opacity-100"
          style={{ left: `calc(${percent}% - 6px)` }}
        />
      </div>

      {hover !== null ? (
        <span
          className="index-mark pointer-events-none absolute -top-4 -translate-x-1/2 rounded bg-black/85 px-1.5 py-0.5 text-white tabular-nums"
          style={{ left: `${duration > 0 ? (hover / duration) * 100 : 0}%` }}
        >
          {formatTime(hover)}
        </span>
      ) : null}
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}
