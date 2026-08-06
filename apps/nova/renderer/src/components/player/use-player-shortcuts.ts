import { useEffect } from "react";

/**
 * Keyboard shortcuts for the player.
 *
 * Shared because the player spans two windows. The controls float in their own
 * window above the video, so a click on the picture lands there rather than on
 * the catalogue window — and whichever window was clicked last is the one the
 * keyboard talks to. Both therefore need to understand the same keys.
 *
 * The two windows reach playback differently: the catalogue window owns the
 * queue and can step episodes directly, while the controls window asks it to.
 * That difference lives in the actions passed in; the key mapping is here.
 */

export interface ShortcutActions {
  togglePlay: () => void;
  /** Step by an offset in seconds. */
  seekBy: (delta: number) => void;
  /** Jump to a fraction of the runtime, 0 to 1. */
  seekToFraction: (fraction: number) => void;
  adjustVolume: (delta: number) => void;
  toggleMute: () => void;
  toggleSubtitles: () => void;
  toggleFullscreen: () => void;
  nextEpisode: () => void;
  previousEpisode: () => void;
  /** Jump past the opening or ending currently playing, if there is one. */
  skipSegment: () => void;
  adjustSpeed: (delta: number) => void;
  /** Leave fullscreen if in it, otherwise close the player. */
  escape: () => void;
}

export function usePlayerShortcuts(active: boolean, actions: ShortcutActions): void {
  useEffect(() => {
    if (!active) return;

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

      // Leave chords to the system.
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      const key = event.key.toLowerCase();

      // Digits jump to a fraction of the runtime, as in most players.
      if (/^[0-9]$/.test(key)) {
        event.preventDefault();
        actions.seekToFraction(Number(key) / 10);
        return;
      }

      switch (key) {
        case " ":
        case "k":
          event.preventDefault();
          actions.togglePlay();
          break;

        case "arrowright":
          event.preventDefault();
          actions.seekBy(5);
          break;
        case "arrowleft":
          event.preventDefault();
          actions.seekBy(-5);
          break;
        case "l":
          actions.seekBy(10);
          break;
        case "j":
          actions.seekBy(-10);
          break;

        case "arrowup":
          event.preventDefault();
          actions.adjustVolume(0.05);
          break;
        case "arrowdown":
          event.preventDefault();
          actions.adjustVolume(-0.05);
          break;

        case "m":
          actions.toggleMute();
          break;
        case "v":
          actions.toggleSubtitles();
          break;
        case "f":
          actions.toggleFullscreen();
          break;
        case "escape":
          actions.escape();
          break;

        case "n":
          actions.nextEpisode();
          break;
        case "p":
          actions.previousEpisode();
          break;
        case "s":
          actions.skipSegment();
          break;

        case "[":
          actions.adjustSpeed(-0.25);
          break;
        case "]":
          actions.adjustSpeed(0.25);
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, actions]);
}
