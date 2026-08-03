"use client";

import { useMutation } from "@tanstack/react-query";
import { ACCENT_TOKENS } from "@vestra/config/constants";
import { ACCENT_PRESETS, type AccentPreset, type Settings, type ThemeMode } from "@vestra/types";
import { GlassCard, cn } from "@vestra/ui";
import { Check, LoaderCircle, Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";

import { applyAccent, applyTheme } from "@/components/theme/theme-controller";
import { toast } from "@/components/ui/toaster";

interface ToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Toggle({ label, description, checked, onChange }: ToggleProps) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 p-4">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          // An inset ring rather than a border: a border would shrink the track's
          // padding box by 2px and make the knob's travel asymmetric.
          checked
            ? "bg-primary"
            : "bg-secondary ring-1 ring-inset ring-border hover:bg-secondary/70",
        )}
      >
        {/*
          `left-1` is required: buttons are `text-align: center`, so an absolutely
          positioned child with no inset resolves to the CENTRE as its static
          position and the knob slides straight off the track.
          Travel = 44px track − 16px knob − (4px × 2 inset) = 20px.
        */}
        <span
          className={cn(
            "absolute left-1 top-1/2 size-4 -translate-y-1/2 rounded-full bg-white shadow-sm",
            "transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </button>
    </label>
  );
}

export function SettingsForm({ initialSettings }: { initialSettings: Settings }) {
  const [settings, setSettings] = useState(initialSettings);
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: async (patch: Partial<Settings>) => {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error("Could not save settings");
      return (await response.json()) as { settings: Settings };
    },
    onSuccess: (result) => {
      setSettings(result.settings);
      setSaved(true);
      // Brief confirmation, then fade back to idle.
      setTimeout(() => setSaved(false), 2000);
    },
    onError: () => toast("Could not save settings", "error"),
  });

  const updateAppearance = (patch: Partial<Settings["appearance"]>) => {
    const next = { ...settings.appearance, ...patch };
    setSettings((current) => ({ ...current, appearance: next }));

    // Apply immediately so the change is visible before the save round-trips.
    if (patch.theme) applyTheme(patch.theme);
    if (patch.accent) applyAccent(patch.accent);
    if (patch.glassEffects !== undefined) {
      document.documentElement.classList.toggle("no-glass", !patch.glassEffects);
    }

    mutation.mutate({ appearance: next });
  };

  const updatePlayback = (patch: Partial<Settings["playback"]>) => {
    setSettings((current) => ({ ...current, playback: { ...current.playback, ...patch } }));
    mutation.mutate({ playback: { ...settings.playback, ...patch } });
  };

  const updatePrivacy = (patch: Partial<Settings["privacy"]>) => {
    setSettings((current) => ({ ...current, privacy: { ...current.privacy, ...patch } }));
    mutation.mutate({ privacy: { ...settings.privacy, ...patch } });
  };

  const themes: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
    { id: "dark", label: "Dark", icon: Moon },
    { id: "light", label: "Light", icon: Sun },
    { id: "system", label: "System", icon: Monitor },
  ];

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Appearance</h2>
          {mutation.isPending ? (
            <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
          ) : saved ? (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <Check className="size-3.5" />
              Saved
            </span>
          ) : null}
        </div>

        <GlassCard className="divide-y divide-glass-border">
          <div className="space-y-3 p-4">
            <div>
              <p className="text-sm font-medium">Theme</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Vestra is designed dark-first. Light mode is fully supported.
              </p>
            </div>

            <div className="flex gap-2">
              {themes.map((entry) => {
                const Icon = entry.icon;
                const active = settings.appearance.theme === entry.id;

                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => updateAppearance({ theme: entry.id })}
                    aria-pressed={active}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium transition-all duration-200",
                      active
                        ? "border-primary/60 bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4" />
                    {entry.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 p-4">
            <div>
              <p className="text-sm font-medium">Accent colour</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Drives buttons, focus rings, progress bars and the active nav state.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {ACCENT_PRESETS.map((preset: AccentPreset) => {
                const tokens = ACCENT_TOKENS[preset];
                const active = settings.appearance.accent === preset;

                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => updateAppearance({ accent: preset })}
                    aria-pressed={active}
                    title={tokens?.label ?? preset}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] transition-all duration-200",
                      active
                        ? "border-foreground/40 bg-secondary"
                        : "border-border hover:bg-secondary/60",
                    )}
                  >
                    <span
                      className="size-4 rounded-full ring-1 ring-inset ring-white/20"
                      style={{ backgroundColor: tokens?.swatch }}
                    />
                    <span className={active ? "text-foreground" : "text-muted-foreground"}>
                      {tokens?.label ?? preset}
                    </span>
                    {active ? <Check className="size-3.5" /> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <Toggle
            label="Glass effects"
            description="Frosted translucency on panels and overlays. Turn off for maximum contrast."
            checked={settings.appearance.glassEffects}
            onChange={(glassEffects) => updateAppearance({ glassEffects })}
          />
        </GlassCard>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Playback</h2>

        <GlassCard className="divide-y divide-glass-border">
          <Toggle
            label="Autoplay next episode"
            description="Continue to the next episode automatically when one finishes."
            checked={settings.playback.autoplayNext}
            onChange={(autoplayNext) => updatePlayback({ autoplayNext })}
          />
          <Toggle
            label="Remember position"
            description="Resume from where you left off instead of restarting."
            checked={settings.playback.rememberPosition}
            onChange={(rememberPosition) => updatePlayback({ rememberPosition })}
          />
        </GlassCard>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Privacy</h2>
        <GlassCard className="divide-y divide-glass-border">
          <Toggle
            label="Track history"
            description="Record what you watch so Continue Watching and History work."
            checked={settings.privacy.trackHistory}
            onChange={(trackHistory) => updatePrivacy({ trackHistory })}
          />
          <Toggle
            label="Blur adult content"
            description="Blur posters flagged as adult until you click them."
            checked={settings.privacy.blurAdultContent}
            onChange={(blurAdultContent) => updatePrivacy({ blurAdultContent })}
          />
        </GlassCard>
      </section>

      {mutation.isError ? (
        <p className="text-xs text-destructive">
          Could not save settings. Check that Vestra can write to its data directory.
        </p>
      ) : null}
    </>
  );
}
