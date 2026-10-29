import { useQuery } from "@tanstack/react-query";
import type { PlaybackEngine } from "@vestra/types";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  bridge,
  type MpvState,
  type ProbeResult,
  type SurfaceRect,
} from "@/lib/bridge";
import { useSettings } from "@/lib/queries";

/**
 * Choosing a playback engine.
 *
 * Chromium decodes a narrow set of formats. Matroska files with HEVC video,
 * 10-bit colour or AC-3 audio — which is most of what gets downloaded — fall
 * outside it, and `<video>` reports that only after it has already failed.
 *
 * Probing first means the decision is made on what the file actually contains
 * rather than on its extension, and the fallback happens before playback
 * instead of after a black screen.
 */

export type ResolvedEngine = "builtin" | "mpv";

export interface EngineDecision {
  engine: ResolvedEngine;
  /** Why mpv was chosen, empty when the built-in player suffices. */
  reasons: string[];
  probe: ProbeResult | undefined;
  /** mpv is needed but not installed. */
  needsMpv: boolean;
  ready: boolean;
}

export function useEngineDecision(
  fileId: string | null,
  nativeStream = false,
): EngineDecision {
  const settings = useSettings();
  const preference: PlaybackEngine = settings.data?.playback.engine ?? "auto";

  const probe = useQuery({
    queryKey: ["probe", fileId],
    queryFn: () => bridge.media.probe(fileId ?? ""),
    // Only worth probing when the answer can change the outcome.
    enabled: fileId !== null && preference === "auto",
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const mpv = useQuery({
    queryKey: ["mpv", "status"],
    queryFn: () => bridge.mpv.status(),
    staleTime: 30_000,
  });

  return useMemo(() => {
    if (preference === "mpv" || nativeStream) {
      return {
        engine: "mpv" as const,
        reasons: [],
        probe: probe.data,
        needsMpv: mpv.data ? !mpv.data.available : false,
        ready: mpv.isFetched,
      };
    }

    if (preference === "builtin") {
      return {
        engine: "builtin" as const,
        reasons: [],
        probe: probe.data,
        needsMpv: false,
        ready: true,
      };
    }

    // Automatic. A probe that failed (no ffprobe, unreadable file) is not a
    // reason to refuse playback — try the built-in player and let it decide.
    const reasons = probe.data?.playable.reasons ?? [];
    const useMpv = reasons.length > 0;

    return {
      engine: useMpv ? ("mpv" as const) : ("builtin" as const),
      reasons,
      probe: probe.data,
      needsMpv: useMpv && mpv.data ? !mpv.data.available : false,
      ready:
        (probe.isFetched || probe.isError || fileId === null) && mpv.isFetched,
    };
  }, [
    preference,
    probe.data,
    probe.isFetched,
    probe.isError,
    mpv.data,
    mpv.isFetched,
    fileId,
    nativeStream,
  ]);
}

/**
 * Keep mpv's surface aligned with an element.
 *
 * mpv renders into a native child window, which the compositor knows nothing
 * about — it will not move or clip with the page. Its position has to be
 * pushed to the main process whenever the element's box changes, including on
 * window resize, or the video drifts away from where it belongs.
 */
export function useSurfaceRect(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return;

    const element = ref.current;
    if (!element) return;

    let last: SurfaceRect | null = null;

    /**
     * Report synchronously, not on an animation frame.
     *
     * While playing, this window is completely covered by the video surface
     * and the controls above it. Chromium treats a fully occluded window as
     * not worth rendering and stops running animation frames, so a callback
     * scheduled that way never arrives — which left the video and controls at
     * their windowed size after going fullscreen, with a black band across the
     * bottom of the screen.
     *
     * Measuring is cheap and the comparison below drops repeats, so there is
     * nothing to gain from deferring it.
     */
    const report = () => {
      const box = element.getBoundingClientRect();
      const rect: SurfaceRect = {
        x: Math.round(box.left),
        y: Math.round(box.top),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };

      // Skip identical updates: a resize can fire many times per second and
      // each one is an IPC round trip plus a native window move.
      if (
        last &&
        last.x === rect.x &&
        last.y === rect.y &&
        last.width === rect.width &&
        last.height === rect.height
      ) {
        return;
      }

      last = rect;
      void bridge.mpv.setRect(rect).catch(() => undefined);
    };

    report();

    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener("resize", report);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [ref, active]);
}

const EMPTY_STATE: MpvState = {
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
};

/** Subscribe to mpv's pushed state for as long as the player is open. */
export function useMpvState(active: boolean): MpvState {
  const [state, setState] = useState<MpvState>(EMPTY_STATE);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    const unsubscribe = bridge.mpv.onState((next) => {
      if (!cancelled) setState(next);
    });

    void bridge.mpv
      .subscribe()
      .then((initial) => {
        if (!cancelled) setState(initial);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [active]);

  return state;
}

/**
 * The file id behind a playback source, when it is a local file.
 *
 * Remote sources have no id to probe and are left to the built-in player.
 */
export function useFileId(locator: string | undefined): string | null {
  return useMemo(() => {
    if (!locator?.startsWith("vestra-media://local/")) return null;
    return decodeURIComponent(locator.replace("vestra-media://local/", ""));
  }, [locator]);
}

/** Latest value in a ref, for callbacks that must not re-create on every change. */
export function useLatest<T>(value: T): React.RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
