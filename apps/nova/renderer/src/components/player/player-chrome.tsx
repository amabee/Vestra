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
import { SongMarker } from "./song-marker";
import { usePlayerShortcuts } from "./use-player-shortcuts";

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
  chapters: [],
  subtitleVisible: true,
  error: null,
  subtitleError: null,
};

const HIDE_AFTER_MS = 2600;

/** An opening or ending range, as published by the catalogue window. */
type SkipRange = NonNullable<NowPlaying["skips"]>[number];

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
   * Kept live even while the controls are faded: nothing beneath this window
   * is interactive during playback, and staying live is what lets a click on
   * the picture bring the application back to the foreground.
   */
  useEffect(() => {
    void bridge.player.setInteractive(true).catch(() => undefined);
  }, []);

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

  /** Stepping goes through mpv so repeated presses accumulate. */
  const seekBy = (delta: number) => {
    void bridge.mpv.seekBy(delta).catch(() => undefined);
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

  /*
    A new playback gets a clean slate.

    Keyed on the session rather than the title or queue position: replaying the
    same episode changes neither, so an opening skipped once would stay skipped
    for as long as the app was open.
  */
  useEffect(() => {
    skippedRanges.current.clear();
  }, [nowPlaying?.sessionId]);

  /* ---------------------------------------------------------------------- *
   * Keyboard
   * ---------------------------------------------------------------------- */

  /**
   * This window handles the shortcuts too.
   *
   * It covers the whole video, so clicking the picture focuses it rather than
   * the catalogue window — and the focused window is the one the keyboard
   * reaches. Both understand the same keys so it does not matter which was
   * clicked last.
   */
  usePlayerShortcuts(true, {
    togglePlay,
    seekBy,
    seekToFraction: (fraction) => {
      if (mpv.duration > 0) seek(fraction * mpv.duration);
    },
    adjustVolume: (delta) => {
      const next = Math.max(0, Math.min(1, mpv.volume + delta));
      void bridge.mpv.setVolume(next).catch(() => undefined);
      if (next > 0 && mpv.muted) void bridge.mpv.setMuted(false).catch(() => undefined);
    },
    toggleMute: () => {
      void bridge.mpv.setMuted(!mpv.muted).catch(() => undefined);
    },
    toggleSubtitles,
    toggleFullscreen,
    nextEpisode: () => {
      if (hasNext) send("next");
    },
    previousEpisode: () => {
      if (hasPrevious) send("previous");
    },
    skipSegment: () => {
      if (activeSkip) seek(activeSkip.endSeconds);
    },
    adjustSpeed: (delta) => {
      void bridge.mpv
        .setSpeed(Math.max(0.25, Math.min(4, mpv.speed + delta)))
        .catch(() => undefined);
    },
    escape: () => {
      if (menuOpen) {
        setMenuOpen(false);
        return;
      }
      if (fullscreen) void bridge.window.setFullscreen(false).then(setFullscreen);
      else send("close");
    },
  });

  const shown = visible || menuOpen;

  /**
   * Dragging the window by the player's header.
   *
   * Done by hand rather than with a drag region: this is a separate window
   * stacked over the video, so the usual mechanism would move it alone and the
   * main process would immediately put it back. Pointer movement is reported
   * and the window underneath is moved instead.
   */
  const dragFrom = useRef<{ x: number; y: number } | null>(null);

  const headerDragProps = {
    onPointerDown: (event: React.PointerEvent) => {
      // Left button only, and never when starting on a control.
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest("button")) return;

      dragFrom.current = { x: event.screenX, y: event.screenY };

      // Capture keeps the drag alive if the pointer outruns the header, but it
      // throws for a pointer id the element never saw — which a synthetic
      // event produces. The drag still works without it.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* not capturable */
      }

      void bridge.player.drag("start").catch(() => undefined);
    },
    onPointerMove: (event: React.PointerEvent) => {
      const from = dragFrom.current;
      if (!from) return;

      const dx = event.screenX - from.x;
      const dy = event.screenY - from.y;
      if (dx === 0 && dy === 0) return;

      dragFrom.current = { x: event.screenX, y: event.screenY };
      void bridge.player.drag("move", dx, dy).catch(() => undefined);
    },
    onPointerUp: (event: React.PointerEvent) => {
      dragFrom.current = null;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* never captured */
      }
    },
    onDoubleClick: (event: React.MouseEvent) => {
      if ((event.target as HTMLElement).closest("button")) return;
      event.stopPropagation();
      void bridge.player.toggleMaximize().catch(() => undefined);
    },
  };

  return (
    <div
      className="relative h-full w-full select-none"
      onDoubleClick={toggleFullscreen}
      // This window cannot take focus, so a click on the video would otherwise
      // leave the application unfocused and every shortcut dead.
      onPointerDownCapture={() => {
        void bridge.player.focus().catch(() => undefined);
      }}
    >
      {/* Skip sits outside the fading chrome: it is offered for a fixed window
          of the episode and should not vanish with the controls. */}
      {activeSkip && !nowPlaying?.autoSkip ? (
        <button
          type="button"
          onClick={() => {
            void bridge.mpv.seek(activeSkip.endSeconds).catch(() => undefined);
          }}
          className="meta absolute bottom-28 right-6 z-10 flex items-center gap-2 rounded-field border border-white/25 bg-black/70 py-2 pl-2 pr-4 text-white backdrop-blur transition-colors hover:bg-primary hover:text-primary-content"
        >
          <SongMarker kind={activeSkip.kind} className="size-14" />
          Skip {activeSkip.kind}
        </button>
      ) : null}

      <div
        className={`h-full w-full transition-opacity duration-200 ${
          shown ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {/* Scrims rather than panels: the video stays visible through them. */}
        {mpv.subtitleError && (
          <p role="status" className="pointer-events-none absolute inset-x-6 top-16 rounded-lg bg-black/80 p-3 text-xs text-white">
            {mpv.subtitleError}
          </p>
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/85 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/90 via-black/60 to-transparent" />

      <header
        className="absolute inset-x-0 top-0 flex h-14 items-center gap-2 px-3"
        {...headerDragProps}
      >
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
          skips={nowPlaying?.skips ?? []}
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

          <IconButton label="Back 10 seconds" onClick={() => seekBy(-10)}>
            <RewindIcon className="size-4" />
          </IconButton>

          <IconButton label="Forward 10 seconds" onClick={() => seekBy(10)}>
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
              <SettingsMenu
                mpv={mpv}
                onClose={() => setMenuOpen(false)}
                reportableSkips={(nowPlaying?.skips ?? [])
                  .map((skip) => skip.skipId)
                  .filter((id): id is string => Boolean(id))}
                onOpenAppSettings={() => {
                  setMenuOpen(false);
                  send("open-settings");
                }}
              />
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

/**
 * The seek bar.
 *
 * Openings and endings are drawn onto the track rather than only announced by
 * a button. Once the timings are trustworthy they are worth showing: a hatched
 * band makes it obvious at a glance where the song sits, how long it runs, and
 * how close it is — the same reason chapter marks are useful on a long video.
 *
 * The bands sit above the progress fill so they stay legible once watched, and
 * a notch marks each boundary so the edges are findable without hovering.
 */
function Scrubber({
  position,
  duration,
  skips,
  onSeek,
  onScrubbing,
}: {
  position: number;
  duration: number;
  skips: SkipRange[];
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
  const ratio = (seconds: number) => (duration > 0 ? (seconds / duration) * 100 : 0);

  // Only meaningful once the duration is known; before that every range would
  // collapse to the left edge.
  const bands = duration > 0 ? skips : [];

  const hovered = hover === null ? null : bands.find(
    (band) => hover >= band.startSeconds && hover < band.endSeconds,
  );

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

        {bands.map((band) => (
          <div
            key={`${band.kind}-${band.startSeconds}`}
            className="pointer-events-none absolute inset-y-0 overflow-hidden"
            style={{
              left: `${ratio(band.startSeconds)}%`,
              width: `${ratio(band.endSeconds - band.startSeconds)}%`,
            }}
          >
            {/* Hatching rather than a flat tint: it reads as a marked-out
                stretch even where the progress fill sits underneath it. */}
            <div
              className="size-full"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(115deg, rgba(255,255,255,0.85) 0 2px, rgba(255,255,255,0.25) 2px 5px)",
              }}
            />
          </div>
        ))}

        <div
          className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-primary opacity-0 transition-opacity group-hover/bar:opacity-100"
          style={{ left: `calc(${percent}% - 6px)` }}
        />
      </div>

      {/* Boundary notches, drawn outside the track so the edges of a song can
          be found without hovering along the bar to hunt for them, with the
          character sitting above the start of each range. */}
      {bands.map((band) => (
        <span key={`mark-${band.kind}-${band.startSeconds}`}>
          <span
            className="pointer-events-none absolute top-0 h-2 w-px bg-white/70"
            style={{ left: `${ratio(band.startSeconds)}%` }}
          />
          <span
            className="pointer-events-none absolute top-0 h-2 w-px bg-white/70"
            style={{ left: `${ratio(band.endSeconds)}%` }}
          />
          <SongMarker
            kind={band.kind}
            className="pointer-events-none absolute -top-12 size-12 -translate-x-1/2 opacity-0 transition-opacity duration-200 group-hover/bar:opacity-100"
            style={{ left: `${ratio(band.startSeconds)}%` }}
          />
        </span>
      ))}

      {hover !== null ? (
        <span
          className="index-mark pointer-events-none absolute -top-5 -translate-x-1/2 whitespace-nowrap rounded bg-black/90 px-1.5 py-0.5 text-white tabular-nums"
          style={{ left: `${ratio(hover)}%` }}
        >
          {hovered ? `${hovered.kind === "opening" ? "OP" : "ED"} · ` : ""}
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
