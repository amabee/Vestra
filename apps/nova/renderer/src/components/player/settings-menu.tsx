import { useEffect, useRef, useState } from "react";

import { bridge, type MpvState, type MpvTrack } from "@/lib/bridge";

/**
 * The settings menu, anchored to its button and drawn over the video.
 *
 * This is a menu rather than a dialog because it can now afford to be one:
 * it lives in the transparent window stacked above mpv's surface, so it
 * floats over the picture instead of displacing it.
 *
 * One level of nesting — a list of settings, then the values for whichever was
 * chosen — which keeps every option two clicks away at most.
 */

type Page = "root" | "speed" | "audio" | "subtitles" | "delay" | "size" | "keys";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const SIZES = [0.75, 0.9, 1, 1.15, 1.3, 1.5] as const;

/**
 * Shortcuts, grouped the way they are reached for.
 *
 * Listed here rather than left to be discovered: none of them are visible in
 * the interface, so an unlisted shortcut may as well not exist.
 */
const SHORTCUTS: { group: string; keys: [string, string][] }[] = [
  {
    group: "Playback",
    keys: [
      ["Space  K", "Play or pause"],
      ["J  L", "Back or forward 10s"],
      ["\u2190  \u2192", "Back or forward 5s"],
      ["0 \u2013 9", "Jump to 0\u201390% of the episode"],
      ["[  ]", "Slower or faster"],
    ],
  },
  {
    group: "Episode",
    keys: [
      ["N  P", "Next or previous episode"],
      ["S", "Skip the opening or ending"],
    ],
  },
  {
    group: "Sound and subtitles",
    keys: [
      ["\u2191  \u2193", "Volume"],
      ["M", "Mute"],
      ["V", "Show or hide subtitles"],
    ],
  },
  {
    group: "Window",
    keys: [
      ["F", "Fullscreen"],
      ["Esc", "Leave fullscreen, or close the player"],
    ],
  },
];

export function SettingsMenu({
  mpv,
  onClose,
  onOpenAppSettings,
  reportableSkips = [],
}: {
  mpv: MpvState;
  onClose: () => void;
  onOpenAppSettings: () => void;
  /** Ranges that came from AniSkip, so can be voted down. */
  reportableSkips?: readonly string[];
}) {
  const [reported, setReported] = useState<"idle" | "sending" | "done" | "failed">(
    "idle",
  );
  const [page, setPage] = useState<Page>("root");
  const container = useRef<HTMLDivElement>(null);

  // Dismiss on an outside click, and step back through pages on Escape.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (page === "root") onClose();
      else setPage("root");
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey, true);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [page, onClose]);

  const audio = mpv.tracks.filter((track) => track.type === "audio");
  const subtitles = mpv.tracks.filter((track) => track.type === "sub");
  const activeSubtitle = subtitles.find((track) => track.selected);

  return (
    <div
      ref={container}
      role="menu"
      className="absolute bottom-full right-0 z-30 mb-2 max-h-[26rem] w-72 overflow-y-auto rounded-box border border-white/12 bg-black/90 py-1 shadow-2xl backdrop-blur-xl"
    >
      {page !== "root" ? (
        <button
          type="button"
          onClick={() => setPage("root")}
          className="mb-1 flex w-full items-center gap-2 border-b border-white/10 px-3 py-2 text-left text-sm text-white/70 transition-colors hover:text-white"
        >
          <Chevron className="size-3.5 rotate-180" />
          {titleFor(page)}
        </button>
      ) : null}

      {page === "root" ? (
        <>
          <Row
            label="Playback speed"
            value={mpv.speed === 1 ? "Normal" : `${mpv.speed}×`}
            onClick={() => setPage("speed")}
          />
          <Row
            label="Audio"
            value={describe(audio.find((track) => track.selected))}
            onClick={() => setPage("audio")}
            disabled={audio.length === 0}
          />
          <Row
            label="Subtitles"
            value={
              mpv.subtitleVisible && activeSubtitle ? describe(activeSubtitle) : "Off"
            }
            onClick={() => setPage("subtitles")}
            disabled={subtitles.length === 0}
          />
          <Row
            label="Subtitle delay"
            value={`${mpv.subtitleDelay > 0 ? "+" : ""}${mpv.subtitleDelay.toFixed(1)}s`}
            onClick={() => setPage("delay")}
          />
          <Row
            label="Subtitle size"
            value={mpv.subtitleScale === 1 ? "Default" : `${Math.round(mpv.subtitleScale * 100)}%`}
            onClick={() => setPage("size")}
          />
          <Row label="Keyboard shortcuts" value="" onClick={() => setPage("keys")} />

          {/*
            Timings are community-submitted and occasionally belong to another
            cut of the episode. Reporting corrects them for everyone rather
            than leaving each viewer to work around it.

            Shown only when there is something to report: a range read from the
            file's own chapters has no submission behind it. Sends once, then
            says so, because this writes to a shared database.
          */}
          {reportableSkips.length > 0 ? (
            <Row
              label="Report wrong timing"
              value={
                reported === "done"
                  ? "Reported"
                  : reported === "sending"
                    ? "Sending…"
                    : reported === "failed"
                      ? "Could not send"
                      : ""
              }
              disabled={reported === "sending" || reported === "done"}
              onClick={() => {
                setReported("sending");
                void Promise.all(
                  reportableSkips.map((id) => bridge.media.reportSkip(id)),
                )
                  .then((results) => {
                    setReported(results.some(Boolean) ? "done" : "failed");
                  })
                  .catch(() => setReported("failed"));
              }}
            />
          ) : null}

          {/* Everything above is scoped to what is playing. Theme, accent and
              library folders are not, and live on a page this window is
              covering — so reaching them means leaving the player, which the
              row says rather than springing it. */}
          <Row
            label="App settings"
            value="Leaves the player"
            onClick={onOpenAppSettings}
          />
        </>
      ) : null}

      {page === "speed"
        ? SPEEDS.map((value) => (
            <Option
              key={value}
              label={value === 1 ? "Normal" : `${value}×`}
              selected={Math.abs(mpv.speed - value) < 0.01}
              onSelect={() => {
                void bridge.mpv.setSpeed(value).catch(() => undefined);
              }}
            />
          ))
        : null}

      {page === "audio"
        ? audio.map((track) => (
            <Option
              key={track.id}
              label={describe(track)}
              selected={track.selected}
              onSelect={() => {
                void bridge.mpv.selectTrack("audio", track.id).catch(() => undefined);
              }}
            />
          ))
        : null}

      {page === "subtitles" ? (
        <>
          <Option
            label="Off"
            selected={!mpv.subtitleVisible || !activeSubtitle}
            onSelect={() => {
              void bridge.mpv.setSubtitleVisible(false).catch(() => undefined);
            }}
          />
          {subtitles.map((track) => (
            <Option
              key={track.id}
              label={describe(track)}
              selected={mpv.subtitleVisible && track.selected}
              onSelect={() => {
                void (async () => {
                  await bridge.mpv.selectTrack("sub", track.id);
                  await bridge.mpv.setSubtitleVisible(true);
                })().catch(() => undefined);
              }}
            />
          ))}
        </>
      ) : null}

      {page === "delay" ? (
        <div className="space-y-3 p-3">
          <p className="text-xs leading-relaxed text-white/50">
            Negative values show subtitles earlier.
          </p>
          <div className="flex items-center gap-2">
            <Step
              label="−0.5"
              onClick={() => {
                void bridge.mpv
                  .setSubtitleDelay(mpv.subtitleDelay - 0.5)
                  .catch(() => undefined);
              }}
            />
            <span className="index-mark flex-1 text-center text-base text-white tabular-nums">
              {mpv.subtitleDelay > 0 ? "+" : ""}
              {mpv.subtitleDelay.toFixed(1)}s
            </span>
            <Step
              label="+0.5"
              onClick={() => {
                void bridge.mpv
                  .setSubtitleDelay(mpv.subtitleDelay + 0.5)
                  .catch(() => undefined);
              }}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              void bridge.mpv.setSubtitleDelay(0).catch(() => undefined);
            }}
            className="w-full rounded-field border border-white/20 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10"
          >
            Reset
          </button>
        </div>
      ) : null}

      {page === "size"
        ? SIZES.map((scale) => (
            <Option
              key={scale}
              label={scale === 1 ? "Default" : `${Math.round(scale * 100)}%`}
              selected={Math.abs(mpv.subtitleScale - scale) < 0.01}
              onSelect={() => {
                void bridge.mpv.setSubtitleScale(scale).catch(() => undefined);
              }}
            />
          ))
        : null}
      {page === "keys" ? (
        <div className="px-3 py-2">
          {SHORTCUTS.map((section) => (
            <div key={section.group} className="mb-3 last:mb-0">
              <p className="meta pb-1.5">{section.group}</p>
              {section.keys.map(([combination, description]) => (
                <div
                  key={combination}
                  className="flex items-baseline gap-3 py-1"
                >
                  <kbd className="index-mark shrink-0 rounded border border-white/20 px-1.5 py-0.5 text-white/85">
                    {combination}
                  </kbd>
                  <span className="text-xs leading-relaxed text-white/55">
                    {description}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function titleFor(page: Page): string {
  switch (page) {
    case "speed":
      return "Playback speed";
    case "audio":
      return "Audio";
    case "subtitles":
      return "Subtitles";
    case "delay":
      return "Subtitle delay";
    case "size":
      return "Subtitle size";
    case "keys":
      return "Keyboard shortcuts";
    default:
      return "Settings";
  }
}

function Row({
  label,
  value,
  onClick,
  disabled = false,
}: {
  label: string;
  value: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors disabled:opacity-30 enabled:hover:bg-white/10"
    >
      <span className="flex-1 text-sm text-white">{label}</span>
      <span className="max-w-28 truncate text-xs text-white/50">{value}</span>
      <Chevron className="size-3 shrink-0 text-white/35" />
    </button>
  );
}

function Option({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-white/10"
    >
      <span
        className={`size-1.5 shrink-0 rounded-full ${selected ? "bg-primary" : "bg-transparent"}`}
      />
      <span className={`truncate ${selected ? "text-white" : "text-white/60"}`}>{label}</span>
    </button>
  );
}

function Step({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="index-mark rounded-field border border-white/20 px-2.5 py-1.5 text-white/80 transition-colors hover:bg-white/10"
    >
      {label}
    </button>
  );
}

function Chevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M9 5l7 7-7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="square"
      />
    </svg>
  );
}

/** A readable name for a track, falling back through what the file provides. */
function describe(track: MpvTrack | undefined): string {
  if (!track) return "None";
  if (track.title) {
    return track.language && track.title.toLowerCase() !== track.language.toLowerCase()
      ? `${track.title} · ${track.language}` : track.title;
  }
  if (track.language) return track.language.toUpperCase();
  return `Track ${track.id}`;
}
