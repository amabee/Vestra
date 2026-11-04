import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { ArrowDownToLine, Check, RotateCw, Sparkles, X } from "lucide-react";
import { usePlayer } from "@/lib/player-store";
import mascot from "@/resources/icon/mascot.png";
import { ReleaseNotes } from "./release-notes";
import {
  updatePromptEvent,
  useAppUpdates,
  useUpdateCommand,
} from "./use-app-updates";
import "./update-prompt.css";

/** An announcement, never an automatic download or restart. */
export function UpdatePrompt() {
  const { data: state } = useAppUpdates();
  const command = useUpdateCommand();
  const playing = usePlayer((player) => player.item !== null);
  const [open, setOpen] = useState(false);
  const [burst, setBurst] = useState(0);
  const seen = useRef(new Set<string>());
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const version = state?.version;
  const phase = state?.phase;

  useEffect(() => {
    if (!version || (phase !== "available" && phase !== "downloaded")) return;
    const token = `${version}:${phase}`;
    if (seen.current.has(token)) return;
    let timer: number | undefined;
    const announce = () => {
      if (playing || document.visibilityState === "hidden") return;
      const otherDialog = document.querySelector("dialog[open]");
      if (otherDialog && otherDialog !== dialog.current) return;
      if (seen.current.has(token)) return;
      seen.current.add(token);
      setOpen(true);
      setBurst((value) => value + 1);
      window.clearInterval(timer);
    };
    announce();
    if (seen.current.has(token)) return;
    timer = window.setInterval(announce, 1000);
    document.addEventListener("visibilitychange", announce);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", announce);
    };
  }, [version, phase, playing]);

  useEffect(() => {
    const show = () => {
      if (
        !version ||
        !["available", "downloading", "downloaded", "error"].includes(
          phase ?? "",
        )
      )
        return;
      seen.current.add(`${version}:${phase}`);
      setOpen(true);
      setBurst((value) => value + 1);
    };
    window.addEventListener(updatePromptEvent, show);
    return () => window.removeEventListener(updatePromptEvent, show);
  }, [version, phase]);

  useEffect(() => {
    if (!open || !version) return;
    const element = dialog.current;
    const previousFocus = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, [open, version]);

  if (!open || !state || !version) return null;
  const ready = phase === "downloaded";
  const downloading = phase === "downloading";
  const installing = phase === "installing";
  const busy = command.isPending || downloading || installing;
  const dismiss = () => setOpen(false);
  return (
    <dialog
      ref={dialog}
      className="nova-update-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div className="nova-update-card">
        <div
          key={`${version}:${burst}`}
          className="nova-update-confetti"
          aria-hidden="true"
        >
          {Array.from({ length: 32 }, (_, index) => (
            <i
              key={index}
              style={
                {
                  "--x": `${(index * 37 + 7) % 100}%`,
                  "--drift": `${(index % 2 ? 1 : -1) * (25 + (index % 5) * 13)}px`,
                  "--delay": `${(index % 8) * 45}ms`,
                  "--turn": `${(index % 2 ? 1 : -1) * (220 + index * 23)}deg`,
                  "--confetti-color": [
                    "var(--color-primary)",
                    "var(--color-accent)",
                    "var(--color-secondary)",
                    "var(--color-base-content)",
                  ][index % 4],
                } as CSSProperties
              }
            />
          ))}
        </div>
        <button
          className="nova-update-close btn btn-sm btn-circle btn-ghost"
          onClick={dismiss}
          aria-label="Close update announcement"
        >
          <X className="size-4" />
        </button>
        <header className="nova-update-hero">
          <button
            className="nova-update-mascot"
            onClick={() => setBurst((value) => value + 1)}
            aria-label="Celebrate this update with confetti"
            title="One more cheer!"
          >
            <span aria-hidden="true" className="nova-update-orbit">
              ✦
            </span>
            <img src={mascot} alt="Vestra Nova mascot" />
            <span className="nova-update-cheer">
              <Sparkles aria-hidden="true" className="size-3" /> tap for
              confetti
            </span>
          </button>
          <div>
            <span className="nova-update-eyebrow">
              {ready ? "Ready when you are" : "A little something new"}
            </span>
            <h2 id={titleId}>
              {ready ? "Let’s roll." : "Your next chapter is here."}
            </h2>
            <p id={descriptionId}>
              {ready
                ? `Vestra Nova ${version} is downloaded. Restart whenever you’re ready.`
                : `Vestra Nova ${version} is available. Take a peek at what’s new.`}
            </p>
            <div className="nova-update-version">
              <span>v{state.currentVersion}</span>
              <span aria-hidden="true">→</span>
              <strong>v{version}</strong>
              {ready && <Check className="size-3.5" aria-label="Downloaded" />}
            </div>
          </div>
        </header>
        <section
          className="nova-update-notes"
          aria-label="What’s new in this update"
        >
          <h3>What’s new</h3>
          {state.releaseNotes ? (
            <ReleaseNotes notes={state.releaseNotes} />
          ) : (
            <p>
              Fresh improvements are on their way. Release details will appear
              here when available.
            </p>
          )}
        </section>
        <div className="nova-update-bottom">
          {downloading && (
            <div className="nova-update-download" role="status">
              <div>
                <span>Bringing the good stuff…</span>
                <strong>{Math.round(state.progress?.percent ?? 0)}%</strong>
              </div>
              <progress
                className="progress progress-primary w-full"
                aria-label="Update download progress"
                max={100}
                value={state.progress?.percent ?? 0}
              />
              {state.progress && (
                <p>
                  {(state.progress.transferred / 1048576).toFixed(1)} /{" "}
                  {(state.progress.total / 1048576).toFixed(1)} MB ·{" "}
                  {(state.progress.bytesPerSecond / 1048576).toFixed(1)} MB/s
                </p>
              )}
            </div>
          )}
          {(phase === "error" || command.error) && (
            <p role="alert" className="nova-update-error">
              {state.message ??
                "The update controls couldn’t be reached. Please try again."}
            </p>
          )}
          <p className="nova-update-hint" role="status">
            {installing
              ? "Restarting to install…"
              : ready
                ? "Restarting will close playback and open readers."
                : downloading
                  ? "Keep browsing. We’ll let you know when it’s ready."
                  : "Download now, restart when it suits you."}
          </p>
          <div className="nova-update-actions">
            <button className="btn btn-ghost" onClick={dismiss}>
              {downloading ? "Keep browsing" : "Later"}
            </button>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => command.mutate(ready ? "install" : "download")}
            >
              {ready ? (
                <RotateCw className="size-4" />
              ) : (
                <ArrowDownToLine className="size-4" />
              )}
              {installing
                ? "Restarting…"
                : downloading
                  ? "Downloading…"
                  : ready
                    ? "Restart and install"
                    : phase === "error"
                      ? "Retry download"
                      : "Download update"}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
