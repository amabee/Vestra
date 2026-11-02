import { useEffect } from "react";
import type { Settings } from "@vestra/types";
import { bridge } from "@/lib/bridge";

export function applyAppearance(settings: Settings, systemLight: boolean) {
  const root = document.documentElement;
  const value = settings.appearance;
  root.dataset.colorMode =
    value.theme === "system" ? (systemLight ? "light" : "dark") : value.theme;
  root.dataset.accent = value.customizeAccent ? value.accent : "vestra";
  root.dataset.motion = value.reducedMotion ? "reduced" : "system";
  root.dataset.glass = value.glassEffects ? "on" : "off";
  root.dataset.sidebarLabels = value.sidebarLabels ? "on" : "off";
  root.style.fontSize = (
    { small: "14px", default: "16px", large: "18px" } as const
  )[value.textScale];
  if (value.customizeAccent && value.customAccent)
    root.style.setProperty("--color-primary", value.customAccent);
  else root.style.removeProperty("--color-primary");
}
/** Both main and native controls receive changes; no query provider is required. */
export function AppearanceController() {
  useEffect(() => {
    if (!bridge.settings?.get) return;
    let current: Settings | undefined;
    let live = true;
    let changed = false;
    const media = matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      if (current) applyAppearance(current, media.matches);
    };
    const unsubscribe = bridge.settings.onChanged?.((settings) => {
      changed = true;
      current = settings;
      apply();
    });
    void bridge.settings
      .get()
      .then((settings) => {
        if (live && !changed) {
          current = settings;
          apply();
        }
      })
      .catch(() => undefined);
    media.addEventListener("change", apply);
    return () => {
      live = false;
      unsubscribe?.();
      media.removeEventListener("change", apply);
    };
  }, []);
  return null;
}
