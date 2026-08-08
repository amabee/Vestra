import { mediaKey, type MediaItem } from "@vestra/types";
import { preferChapters, skipRangesFromChapters } from "@vestra/core/chapters";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { bridge } from "@/lib/bridge";
import { usePlayer } from "@/lib/player-store";
import { useSettings } from "@/lib/queries";

import {
  useEngineDecision,
  useFileId,
  useLatest,
  useMpvState,
  useSurfaceRect,
} from "./use-engine";

/** Below this, an entry is an accidental open rather than somewhere to return to. */
const MIN_RESUME_PERCENT = 0.01;

/**
 * Where a file should start.
 *
 * A finished episode starts again from the top — reaching the end and then
 * being dropped back two seconds from it is not a useful place to resume.
 */
async function resumeSecondsFor(
  item: MediaItem | null,
  fileId: string,
  rememberPosition: boolean,
): Promise<number> {
  if (!item || !rememberPosition) return 0;

  const all = await bridge.progress.all().catch(() => null);
  const entry = all?.[`${mediaKey(item)}#${fileId}`];
  if (!entry || entry.completed || entry.percent < MIN_RESUME_PERCENT) return 0;

  return Math.floor(entry.positionSeconds);
}

/**
 * The player, as far as the catalogue window is concerned.
 *
 * Almost nothing is drawn here. mpv paints the video into a native window
 * stacked over this one, and the controls live in a transparent window stacked
 * over that — which is what lets them float above the picture instead of
 * pushing it around. This component's job is to hold the queue, decide which
 * engine plays a file, tell the main process where the video belongs, and keep
 * progress written down.
 *
 * The built-in `<video>` path is still here for anything Chromium can decode,
 * and keeps its own controls-free surface for the same overlay to sit on.
 */
export function PlayerOverlay() {
  const { item, queue, index, next, previous, close } = usePlayer();
  const source = queue[index] ?? null;
  const navigate = useNavigate();

  const videoRef = useRef<HTMLVideoElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const fileId = useFileId(source?.locator);
  const decision = useEngineDecision(fileId);

  const [override, setOverride] = useState<"builtin" | "mpv" | null>(null);
  const engine = override ?? decision.engine;
  const usingMpv = engine === "mpv" && Boolean(item) && Boolean(source);

  const mpv = useMpvState(usingMpv);
  useSurfaceRect(surfaceRef, usingMpv);

  const [failed, setFailed] = useState<string | null>(null);

  const settings = useSettings();
  const queryClient = useQueryClient();
  const autoplayNext = settings.data?.playback.autoplayNext ?? true;
  const skipSegments = settings.data?.playback.skipSegments ?? true;
  const autoSkipSegments = settings.data?.playback.autoSkipSegments ?? false;

  // Read at open time only, so a settings change cannot restart the file.
  const itemRef = useLatest(item);
  const rememberPositionRef = useLatest(
    settings.data?.playback.rememberPosition ?? true,
  );

  const hasNext = index + 1 < queue.length;

  /**
   * A short episode designation.
   *
   * The adapter builds this now. It used to be recovered from the release
   * filename with a regex, which meant the player disagreed with the episode
   * list whenever the filename was unusual.
   */
  const episodeLabel = useMemo(() => {
    if (source?.label) return source.label;
    return queue.length > 1 ? `Ep ${index + 1}` : null;
  }, [source?.label, queue.length, index]);

  /**
   * Which season and episode this file is, for looking up skip times.
   *
   * Taken from the file record rather than the queue position or the matched
   * entry. The queue index is wrong for a folder that starts at episode five,
   * and the matched entry is frequently the series' first season even when the
   * files are a later one — which is exactly how a skip button ends up
   * appearing halfway through an episode and never during the opening.
   */
  const placement = useMemo(() => {
    if (source?.episode != null) {
      return { season: source.season ?? 1, episode: source.episode };
    }

    // Nothing parsed: assume a single-season release, numbered in order.
    return { season: 1, episode: queue.length > 1 ? index + 1 : 1 };
  }, [source?.season, source?.episode, queue.length, index]);

  /**
   * Opening and ending timings.
   *
   * Community-sourced, because the files carry no chapter markers to read them
   * from. Nothing known means no skip control, which is the common case for
   * obscure or very new series.
   *
   * The episode's real duration is sent along so the lookup can be rejected
   * when it does not plausibly belong to this file.
   */
  const skipTimes = useQuery({
    queryKey: [
      "skip-times",
      item?.source,
      item?.sourceId,
      placement.season,
      placement.episode,
    ],
    queryFn: () =>
      bridge.media.skipTimes({
        source: item?.source ?? "",
        sourceId: item?.sourceId ?? "",
        seasonNumber: placement.season,
        episodeNumber: placement.episode,
        episodeLengthSeconds: Math.round(mpv.duration),
      }),
    enabled: Boolean(item) && skipSegments && mpv.duration > 0,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  /**
   * What the skip control actually offers.
   *
   * A file that carries its own chapters is the better authority: the ranges
   * come from the release being watched rather than from a database keyed by a
   * series id, so there is no season to resolve and no episode numbering to
   * line up. Most releases have none, and then the community timings stand.
   */
  const skips = useMemo(
    () =>
      preferChapters(
        skipRangesFromChapters(mpv.chapters, mpv.duration),
        skipTimes.data ?? [],
      ),
    [mpv.chapters, mpv.duration, skipTimes.data],
  );

  /* ---------------------------------------------------------------------- *
   * Feeding the controls window
   * ---------------------------------------------------------------------- */

  useEffect(() => {
    if (!item) return;

    void bridge.player
      .setNowPlaying({
        title: item.title,
        episodeLabel,
        index,
        total: queue.length,
        engine: usingMpv ? "mpv" : "builtin",
        skips: skipSegments ? skips : [],
        autoSkip: autoSkipSegments,
      })
      .catch(() => undefined);
  }, [
    item,
    episodeLabel,
    index,
    queue.length,
    usingMpv,
    skips,
    skipSegments,
    autoSkipSegments,
  ]);

  /**
   * Act on what the controls window asks for.
   *
   * Stepping between episodes needs the queue, which lives here rather than
   * being duplicated into the other window.
   */
  useEffect(() => {
    return bridge.player.onCommand((command) => {
      switch (command) {
        case "next":
          next();
          break;
        case "previous":
          previous();
          break;
        case "close":
          close();
          break;
        case "toggle-fullscreen":
          void bridge.window
            .isFullscreen()
            .then((value) => bridge.window.setFullscreen(!value))
            .catch(() => undefined);
          break;
        // The settings page is in this window, underneath the player, so
        // showing it means putting the player away first.
        case "open-settings":
          close();
          void navigate("/settings");
          break;
      }
    });
  }, [next, previous, close, navigate]);

  /* ---------------------------------------------------------------------- *
   * Keyboard
   * ---------------------------------------------------------------------- */

  /**
   * Shortcuts live here, not in the controls window.
   *
   * That window is deliberately non-focusable so it cannot steal focus from
   * the interface, which means it never receives key events. This window has
   * focus while playing, so it is the one that can hear them.
   */
  useEffect(() => {
    if (!item) return;

    const onKey = (event: KeyboardEvent) => {
      // Never swallow typing.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }

      if (event.ctrlKey || event.altKey || event.metaKey) return;

      const at = usingMpv ? mpv.position : (videoRef.current?.currentTime ?? 0);

      /** Absolute seek, for jumps to a known point. */
      const seek = (seconds: number) => {
        const to = Math.max(0, seconds);
        if (usingMpv) void bridge.mpv.seek(to).catch(() => undefined);
        else if (videoRef.current) videoRef.current.currentTime = to;
      };

      /**
       * Relative seek, for stepping.
       *
       * mpv applies the offset to its own clock. Computing it here from a
       * position that lags by a frame would make two quick presses land in the
       * same place instead of accumulating.
       */
      const seekBy = (delta: number) => {
        if (usingMpv) void bridge.mpv.seekBy(delta).catch(() => undefined);
        else if (videoRef.current) videoRef.current.currentTime += delta;
      };

      const setVolume = (value: number) => {
        const clamped = Math.max(0, Math.min(1, value));
        if (usingMpv) {
          void bridge.mpv.setVolume(clamped).catch(() => undefined);
          if (clamped > 0 && mpv.muted) {
            void bridge.mpv.setMuted(false).catch(() => undefined);
          }
        } else if (videoRef.current) {
          videoRef.current.volume = clamped;
        }
      };

      const key = event.key.toLowerCase();

      // Digits jump to a fraction of the runtime, as in most players.
      if (/^[0-9]$/.test(key) && mpv.duration > 0) {
        event.preventDefault();
        seek((Number(key) / 10) * mpv.duration);
        return;
      }

      switch (key) {
        case " ":
        case "k":
          event.preventDefault();
          if (usingMpv) {
            void (mpv.paused ? bridge.mpv.play() : bridge.mpv.pause()).catch(
              () => undefined,
            );
          } else if (videoRef.current) {
            if (videoRef.current.paused) void videoRef.current.play();
            else videoRef.current.pause();
          }
          break;

        case "arrowright":
          event.preventDefault();
          seekBy(5);
          break;
        case "arrowleft":
          event.preventDefault();
          seekBy(-5);
          break;
        case "l":
          seekBy(10);
          break;
        case "j":
          seekBy(-10);
          break;

        case "arrowup":
          event.preventDefault();
          setVolume((usingMpv ? mpv.volume : (videoRef.current?.volume ?? 1)) + 0.05);
          break;
        case "arrowdown":
          event.preventDefault();
          setVolume((usingMpv ? mpv.volume : (videoRef.current?.volume ?? 1)) - 0.05);
          break;

        case "m":
          if (usingMpv) void bridge.mpv.setMuted(!mpv.muted).catch(() => undefined);
          else if (videoRef.current) videoRef.current.muted = !videoRef.current.muted;
          break;

        case "f":
          void bridge.window
            .isFullscreen()
            .then((value) => bridge.window.setFullscreen(!value))
            .catch(() => undefined);
          break;

        case "escape":
          // Leave fullscreen first; only close the player when already windowed.
          void bridge.window
            .isFullscreen()
            .then(async (value) => {
              if (value) await bridge.window.setFullscreen(false);
              else close();
            })
            .catch(() => undefined);
          break;

        case "n":
          if (hasNext) next();
          break;
        case "p":
          if (index > 0) previous();
          break;

        case "v": {
          if (!usingMpv) break;
          const subtitles = mpv.tracks.filter((track) => track.type === "sub");
          const on = mpv.subtitleVisible && subtitles.some((track) => track.selected);
          void (async () => {
            if (on) {
              await bridge.mpv.setSubtitleVisible(false);
              return;
            }
            const chosen = subtitles.find((track) => track.selected) ?? subtitles[0];
            if (chosen) await bridge.mpv.selectTrack("sub", chosen.id);
            await bridge.mpv.setSubtitleVisible(true);
          })().catch(() => undefined);
          break;
        }

        // Jump past whichever opening or ending is playing right now.
        case "s": {
          const current = skips.find(
            (range) => at >= range.startSeconds && at < range.endSeconds - 1,
          );
          if (current) seek(current.endSeconds);
          break;
        }

        case "[":
          if (usingMpv) {
            void bridge.mpv.setSpeed(Math.max(0.25, mpv.speed - 0.25)).catch(
              () => undefined,
            );
          }
          break;
        case "]":
          if (usingMpv) {
            void bridge.mpv.setSpeed(Math.min(4, mpv.speed + 0.25)).catch(
              () => undefined,
            );
          }
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    item,
    usingMpv,
    mpv.position,
    mpv.paused,
    mpv.muted,
    mpv.volume,
    mpv.speed,
    mpv.duration,
    mpv.tracks,
    mpv.subtitleVisible,
    skips,
    hasNext,
    index,
    next,
    previous,
    close,
  ]);

  /* ---------------------------------------------------------------------- *
   * Playback
   * ---------------------------------------------------------------------- */

  useEffect(() => {
    if (!usingMpv || !fileId || !decision.ready || decision.needsMpv) return;

    let cancelled = false;

    /*
      Progress is read here rather than subscribed to. Held as query state it
      would change every time the periodic save ran, and this effect would
      reopen the file mid-playback each time it did.
    */
    void (async () => {
      const startSeconds = await resumeSecondsFor(
        itemRef.current,
        fileId,
        rememberPositionRef.current,
      );
      if (cancelled) return;

      const box = surfaceRef.current?.getBoundingClientRect();

      await bridge.mpv.open({
        fileId,
        // An explicit choice from the episode list wins over stored progress.
        startSeconds: usePlayer.getState().startAt ?? startSeconds,
        rect: {
          x: Math.round(box?.left ?? 0),
          y: Math.round(box?.top ?? 0),
          width: Math.round(box?.width ?? 0),
          height: Math.round(box?.height ?? 0),
        },
      });
    })().catch((error: unknown) => {
      if (cancelled) return;
      setFailed(error instanceof Error ? error.message : "mpv could not start.");
      setOverride("builtin");
    });

    return () => {
      cancelled = true;
    };
  }, [usingMpv, fileId, decision.ready, decision.needsMpv]);

  // Leaving the player packs both extra windows away; mpv itself keeps running
  // so the next episode does not pay for another process launch.
  useEffect(() => {
    if (item) return;
    setOverride(null);
    setFailed(null);
    void bridge.mpv.close().catch(() => undefined);

    // Only leave fullscreen if it was entered. Calling this unconditionally
    // also drops a maximised window back to its restored size, so the window
    // shrank every time the player was closed.
    void bridge.window
      .isFullscreen()
      .then((value) => (value ? bridge.window.setFullscreen(false) : undefined))
      .catch(() => undefined);
  }, [item]);

  /* ---------------------------------------------------------------------- *
   * Progress
   * ---------------------------------------------------------------------- */

  /**
   * Everything the save needs, in one ref.
   *
   * This used to read a `useMutation` object inside a `useCallback`. That
   * object gets a new identity every render, so the callback did too, so the
   * effect below re-ran every render — and its cleanup called the save, which
   * set state, which rendered again. React caught it as error #185.
   */
  const stateRef = useRef<{
    item: MediaItem | null;
    position: number;
    duration: number;
    episodeId: string | null;
  }>({ item: null, position: 0, duration: 0, episodeId: null });

  stateRef.current = {
    item,
    position: usingMpv ? mpv.position : (videoRef.current?.currentTime ?? 0),
    duration: usingMpv ? mpv.duration : (videoRef.current?.duration ?? 0),
    episodeId: fileId,
  };

  const persist = useCallback(() => {
    const {
      item: current,
      position: at,
      duration: total,
      episodeId,
    } = stateRef.current;
    if (!current || total <= 0 || at <= 0) return;

    void bridge.progress
      .save({
        ref: current,
        episodeId,
        positionSeconds: at,
        durationSeconds: total,
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!item) return;
    const timer = setInterval(persist, 15_000);
    return () => {
      clearInterval(timer);
      persist();
    };
  }, [item, persist]);

  // Roll on when an episode finishes, if there is somewhere to go.
  useEffect(() => {
    if (!usingMpv || !mpv.ended || !hasNext || !autoplayNext) return;
    persist();
    next();
  }, [usingMpv, mpv.ended, hasNext, autoplayNext, persist, next]);

  // Watched state is derived from progress, so refresh the views that show it.
  useEffect(() => {
    if (item) return;
    void queryClient.invalidateQueries({ queryKey: ["progress"] });
  }, [item, queryClient]);

  if (!item || !source) return null;

  const error = failed ?? (usingMpv ? mpv.error : null);

  return (
    <div className="fixed inset-0 z-50 bg-black">
      {usingMpv ? (
        // mpv paints into a native window positioned over this element, and
        // the controls window over that. This exists only to be measured.
        <div ref={surfaceRef} className="size-full" />
      ) : (
        <video
          ref={videoRef}
          src={source.locator}
          autoPlay
          className="size-full"
          onError={() => {
            if (decision.reasons.length > 0 && !decision.needsMpv) {
              setOverride("mpv");
              return;
            }
            setFailed("The decoder rejected this file.");
          }}
        />
      )}

      {decision.needsMpv ? <MpvMissing reasons={decision.reasons} /> : null}

      {error && !decision.needsMpv ? (
        <div className="absolute inset-0 grid place-items-center bg-black p-8">
          <div className="max-w-md text-center">
            <p className="font-serif text-display-sm">Cannot play this</p>
            <p className="mt-2 text-sm leading-relaxed text-base-content/55">{error}</p>
            {decision.probe ? (
              <p className="meta mt-3">
                {decision.probe.video[0]?.codec ?? "?"} ·{" "}
                {decision.probe.audio[0]?.codec ?? "?"} ·{" "}
                {decision.probe.container ?? "?"}
              </p>
            ) : null}
            <button
              type="button"
              onClick={close}
              className="mt-6 rounded-field border border-base-content/20 px-4 py-2 text-sm transition-colors hover:bg-base-content/10"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Shown when a file needs mpv and it cannot be found. */
function MpvMissing({ reasons }: { reasons: string[] }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-black p-8">
      <div className="max-w-lg text-center">
        <p className="font-serif text-display-sm">This file needs mpv</p>
        <p className="mt-3 text-sm leading-relaxed text-base-content/55">
          {reasons.length > 0
            ? reasons.join(" ")
            : "This file uses a format the built-in player cannot decode."}
        </p>
        <p className="mt-4 text-sm leading-relaxed text-base-content/55">
          mpv normally ships with Vestra. If this build was packaged without it,
          install mpv and it will be picked up automatically, or set its location
          in Settings.
        </p>
        <button
          type="button"
          onClick={() => void bridge.shell.openExternal("https://mpv.io/installation/")}
          className="mt-5 rounded-field border border-base-content/20 px-4 py-2 text-sm transition-colors hover:bg-primary hover:text-primary-content"
        >
          Installation guide
        </button>
      </div>
    </div>
  );
}
