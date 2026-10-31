import { useEffect, useRef, useState } from "react";

import { bridge, type MpvState, type MpvTrack } from "@/lib/bridge";

import {
  getSubtitleColor,
  getSubtitleFont,
  saveSubtitleColor,
  saveSubtitleFont,
} from "./subtitle-style";

/**
 * The settings menu, anchored to its button and drawn over the video.
 *
 * This is a menu rather than a dialog because it can now afford to be one:
 * it lives in the transparent window stacked above mpv's surface, so it
 * floats over the picture instead of displacing it.
 *
 * Settings are grouped under parents: Subtitles holds everything about how
 * subtitles look and sound, More holds the rest. Every option is at most
 * three clicks away.
 */

type Page =
  | "root"
  | "quality"
  | "speed"
  | "audio"
  | "subtitle-group"
  | "subtitles"
  | "delay"
  | "size"
  | "font"
  | "color"
  | "more"
  | "keys";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const SIZES = [0.75, 0.9, 1, 1.15, 1.3, 1.5] as const;

/** Subtitle colours offered as swatches. White is mpv's default. */
const SUBTITLE_COLORS: [string, string][] = [
  ["White", "#FFFFFF"],
  ["Yellow", "#FFE600"],
  ["Green", "#7CFC00"],
  ["Cyan", "#00E5FF"],
  ["Pink", "#FF6EC7"],
];

/** Letters, digits, spaces and a few punctuation marks found in font names. */
const FONT_NAME = /^[\p{L}\p{N} .'_-]{1,64}$/u;

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
  streamSource = null,
  activeStream = null,
}: {
  mpv: MpvState;
  onClose: () => void;
  onOpenAppSettings: () => void;
  /** Ranges that came from AniSkip, so can be voted down. */
  reportableSkips?: readonly string[];
  /** The add-on stream this episode came from, when it offers qualities. */
  streamSource?: string | null;
  /** The stream playing now. */
  activeStream?: string | null;
}) {
  const [reported, setReported] = useState<
    "idle" | "sending" | "done" | "failed"
  >("idle");
  const [page, setPage] = useState<Page>("root");
  const [font, setFont] = useState<string | null>(getSubtitleFont);
  const [color, setColor] = useState<string | null>(getSubtitleColor);
  const [appearanceError, setAppearanceError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

  // Dismiss on an outside click, and step back one page on Escape.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (page === "root") onClose();
      else setPage(parentOf(page));
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
  const trackValue =
    subtitles.length === 0
      ? "None"
      : mpv.subtitleVisible && activeSubtitle
        ? describe(activeSubtitle)
        : "Off";

  return (
    <div
      ref={container}
      role="menu"
      className="absolute bottom-full right-0 z-30 mb-2 max-h-[26rem] w-72 overflow-y-auto rounded-box border border-white/12 bg-black/90 py-1 shadow-2xl backdrop-blur-xl"
    >
      {page !== "root" ? (
        <button
          type="button"
          onClick={() => setPage(parentOf(page))}
          className="mb-1 flex w-full items-center gap-2 border-b border-white/10 px-3 py-2 text-left text-sm text-white/70 transition-colors hover:text-white"
        >
          <Chevron className="size-3.5 rotate-180" />
          {titleFor(page)}
        </button>
      ) : null}

      {page === "root" ? (
        <>
          {streamSource ? (
            <Row
              label="Quality"
              value={
                activeStream && activeStream !== streamSource
                  ? "Selected"
                  : "Auto (HD first)"
              }
              onClick={() => setPage("quality")}
            />
          ) : null}
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
            value={trackValue}
            onClick={() => setPage("subtitle-group")}
          />
          <Row label="More" value="" onClick={() => setPage("more")} />
        </>
      ) : null}

      {page === "quality" && streamSource ? (
        <QualityList streamSource={streamSource} activeStream={activeStream} />
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
                void bridge.mpv
                  .selectTrack("audio", track.id)
                  .catch(() => undefined);
              }}
            />
          ))
        : null}

      {page === "subtitle-group" ? (
        <>
          {subtitles.length === 0 ? (
            <p className="px-3 pt-2 text-xs leading-relaxed text-white/50">
              No subtitles for this source. Font, size and delay still apply to
              any that come later.
            </p>
          ) : null}
          <Row
            label="Track"
            value={trackValue}
            onClick={() => setPage("subtitles")}
            disabled={subtitles.length === 0}
          />
          <Row
            label="Font"
            value={font ?? "Default"}
            onClick={() => setPage("font")}
          />
          <Row
            label="Colour"
            value={
              color
                ? (SUBTITLE_COLORS.find(([, hex]) => hex === color)?.[0] ??
                  color)
                : "White"
            }
            onClick={() => setPage("color")}
          />
          <Row
            label="Size"
            value={
              mpv.subtitleScale === 1
                ? "Default"
                : `${Math.round(mpv.subtitleScale * 100)}%`
            }
            onClick={() => setPage("size")}
          />
          <Row
            label="Delay"
            value={`${mpv.subtitleDelay > 0 ? "+" : ""}${mpv.subtitleDelay.toFixed(1)}s`}
            onClick={() => setPage("delay")}
          />
        </>
      ) : null}

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

      {page === "font" ? (
        <FontPage
          font={font}
          onChange={(family) => {
            saveSubtitleFont(family);
            setFont(family);
          }}
        />
      ) : null}

      {page === "color" ? (
        <div className="space-y-3 p-3">
          <p className="text-xs leading-relaxed text-white/50">
            Pick a text colour. Subtitles that style their own text may keep
            their colours.
          </p>
          {appearanceError ? (
            <p role="alert" className="text-xs text-red-300">
              {appearanceError}
            </p>
          ) : null}
          <div className="grid grid-cols-5 gap-2">
            {SUBTITLE_COLORS.map(([name, hex]) => {
              const selected = (color ?? "#FFFFFF") === hex;
              return (
                <button
                  key={hex}
                  type="button"
                  title={name}
                  aria-label={`Subtitle colour ${name}`}
                  aria-pressed={selected}
                  onClick={() => {
                    setAppearanceError(null);
                    void bridge.mpv
                      .setSubtitleColor(hex)
                      .then(() => {
                        saveSubtitleColor(hex);
                        setColor(hex);
                      })
                      .catch(() =>
                        setAppearanceError(
                          "Could not apply subtitle colour. Try again.",
                        ),
                      );
                  }}
                  style={{ backgroundColor: hex }}
                  className={`size-9 rounded-full border-2 transition-transform hover:scale-110 ${
                    selected ? "border-white" : "border-white/20"
                  }`}
                />
              );
            })}
          </div>
        </div>
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

      {page === "more" ? (
        <>
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
          <Row
            label="Keyboard shortcuts"
            value=""
            onClick={() => setPage("keys")}
          />

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

/** The page a back step returns to. Subtitle pages go back to Subtitles. */
function parentOf(page: Page): Page {
  switch (page) {
    case "subtitles":
    case "delay":
    case "size":
    case "font":
    case "color":
      return "subtitle-group";
    case "subtitle-group":
    case "more":
      return "root";
    case "keys":
      return "more";
    default:
      return "root";
  }
}

function titleFor(page: Page): string {
  switch (page) {
    case "quality":
      return "Quality";
    case "speed":
      return "Playback speed";
    case "audio":
      return "Audio";
    case "subtitle-group":
      return "Subtitles";
    case "subtitles":
      return "Subtitle track";
    case "delay":
      return "Subtitle delay";
    case "size":
      return "Subtitle size";
    case "font":
      return "Subtitle font";
    case "color":
      return "Subtitle colour";
    case "more":
      return "More";
    case "keys":
      return "Keyboard shortcuts";
    default:
      return "Settings";
  }
}

/**
 * Pick the subtitle font by name.
 *
 * Any font installed on this PC works. A name the PC does not have falls back
 * to the default font without an error, so the picture never goes blank.
 */
function FontPage({
  font,
  onChange,
}: {
  font: string | null;
  onChange: (family: string | null) => void;
}) {
  const [draft, setDraft] = useState(font ?? "");
  const [error, setError] = useState<string | null>(null);

  const apply = (value: string) => {
    const family = value.trim() || null;
    if (family && !FONT_NAME.test(family)) {
      setError("Use letters, numbers and spaces only.");
      return;
    }
    setError(null);
    void bridge.mpv
      .setSubtitleFont(family)
      .then(() => {
        setDraft(family ?? "");
        onChange(family);
      })
      .catch(() => setError("Could not apply subtitle font. Try again."));
  };

  return (
    <div className="space-y-3 p-3">
      <p className="text-xs leading-relaxed text-white/50">
        Type the name of a font installed on this PC, such as Arial or Georgia.
      </p>
      <input
        type="text"
        value={draft}
        maxLength={64}
        placeholder="Default font"
        aria-label="Subtitle font name"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") apply(draft);
        }}
        className="w-full rounded-field border border-white/20 bg-black/40 px-2.5 py-1.5 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/60"
      />
      {error ? (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => apply(draft)}
          className="flex-1 rounded-field border border-white/20 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={() => apply("")}
          className="flex-1 rounded-field border border-white/20 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10"
        >
          Default
        </button>
      </div>
    </div>
  );
}

/**
 * The qualities the add-on offers for this episode.
 *
 * A choice goes to the catalogue window, which reopens the episode on that
 * stream at the current position.
 */
function QualityList({
  streamSource,
  activeStream,
}: {
  streamSource: string;
  activeStream: string | null;
}) {
  // Plain fetch rather than a query: this window has no query provider.
  const [state, setState] = useState<{
    status: "loading" | "ready" | "failed";
    choices: { locator: string; label: string }[];
  }>({ status: "loading", choices: [] });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", choices: [] });
    bridge.media
      .streamQualities(streamSource)
      .then((choices) => {
        if (!cancelled) setState({ status: "ready", choices });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "failed", choices: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [streamSource]);

  if (state.status === "loading") {
    return (
      <p role="status" className="px-3 py-2 text-sm text-white/50">
        Loading qualities…
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <p role="alert" className="px-3 py-2 text-sm text-white/50">
        Could not load qualities.
      </p>
    );
  }
  if (state.choices.length === 0) {
    return (
      <p className="px-3 py-2 text-sm text-white/50">No other qualities.</p>
    );
  }

  return (
    <>
      <Option
        label="Auto (HD first)"
        selected={activeStream === streamSource}
        onSelect={() => {
          void bridge.player.setQuality(streamSource).catch(() => undefined);
        }}
      />
      {state.choices.map((choice) => (
        <Option
          key={choice.locator}
          label={choice.label}
          selected={activeStream === choice.locator}
          onSelect={() => {
            void bridge.player
              .setQuality(choice.locator)
              .catch(() => undefined);
          }}
        />
      ))}
    </>
  );
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
      <span className={`truncate ${selected ? "text-white" : "text-white/60"}`}>
        {label}
      </span>
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
    return track.language &&
      track.title.toLowerCase() !== track.language.toLowerCase()
      ? `${track.title} · ${track.language}`
      : track.title;
  }
  if (track.language) return track.language.toUpperCase();
  return `Track ${track.id}`;
}
