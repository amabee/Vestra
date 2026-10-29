import { useCallback, useEffect, useRef, useState } from "react";

export function editableTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest(
      "input,select,textarea,[contenteditable]:not([contenteditable=false]),[role=textbox]",
    )
  );
}

export function useReaderChrome(overlayOpen: boolean) {
  const root = useRef<HTMLElement>(null);
  const [immersive, setImmersive] = useState(false);
  const [awake, setAwake] = useState(true);
  const [focused, setFocused] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wake = useCallback(() => {
    setAwake(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAwake(false), 2400);
  }, []);
  useEffect(() => {
    wake();
    return () => clearTimeout(timer.current);
  }, [wake, immersive, overlayOpen, focused]);
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
      wake();
    } catch {
      setError(
        "Fullscreen could not be opened. You can continue reading in this window.",
      );
    }
  }, [wake]);
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
        setImmersive((value) => !value);
      } else if (event.key === "Escape") {
        if (document.fullscreenElement)
          void document.exitFullscreen().catch(() => undefined);
        wake();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFullscreen, wake]);
  return {
    root,
    immersive,
    setImmersive,
    fullscreen,
    toggleFullscreen,
    error,
    wake,
    visible: !immersive || awake || overlayOpen || focused,
    setFocused,
  };
}
