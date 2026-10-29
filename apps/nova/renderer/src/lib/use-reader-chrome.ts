import { useCallback, useEffect, useRef, useState } from "react";

export function editableTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest(
      "input,select,textarea,[contenteditable]:not([contenteditable=false]),[role=textbox]",
    )
  );
}

/** Reader controls stay in the state the reader explicitly chose. */
export function useReaderChrome() {
  const root = useRef<HTMLElement>(null);
  const [immersive, setImmersive] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState("");
  const wake = useCallback(() => setImmersive(false), []);
  const toggleControls = useCallback(() => setImmersive((old) => !old), []);
  useEffect(() => {
    const update = () =>
      setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
      setError("");
    } catch {
      setError(
        "Fullscreen could not be opened. You can continue reading in this window.",
      );
    }
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        editableTarget(event.target)
      )
        return;
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        void toggleFullscreen();
      } else if (event.key.toLowerCase() === "i") {
        event.preventDefault();
        toggleControls();
      } else if (event.key === "Escape") {
        if (document.fullscreenElement)
          void document.exitFullscreen().catch(() => undefined);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFullscreen, toggleControls]);
  return {
    root,
    immersive,
    setImmersive,
    fullscreen,
    toggleFullscreen,
    error,
    wake,
    toggleControls,
    visible: !immersive,
  };
}
