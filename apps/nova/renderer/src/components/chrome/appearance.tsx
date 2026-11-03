import { useEffect } from "react";
import type { Settings } from "@vestra/types";
import { bridge } from "@/lib/bridge";

function rgbFromHex(hex: string) {
  const full =
    hex.length === 4 ? "#" + [...hex.slice(1)].map((c) => c + c).join("") : hex;
  return [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16));
}
function luminance(hex: string) {
  const rgb = rgbFromHex(hex)
    .map((v) => v / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}
function contrastingText(hex: string) {
  return luminance(hex) > 0.179 ? "#000000" : "#ffffff";
}
/** Keep the user's hue while ensuring accent text is readable on its surface. */
export function accessibleAccent(accent: string, background: string) {
  const base = luminance(background);
  const contrast = (color: string) =>
    (Math.max(luminance(color), base) + 0.05) /
    (Math.min(luminance(color), base) + 0.05);
  if (contrast(accent) >= 4.5) return accent;
  const target = contrastingText(background) === "#ffffff" ? 255 : 0;
  const rgb = rgbFromHex(accent);
  for (let step = 1; step <= 100; step++) {
    const mixed =
      "#" +
      rgb
        .map((v) =>
          Math.round(v + ((target - v) * step) / 100)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("");
    if (contrast(mixed) >= 4.5) return mixed;
  }
  return contrastingText(background);
}
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
  if (value.customizeAccent && value.customAccent) {
    const effective = accessibleAccent(
      value.customAccent,
      value.backgroundColor ??
        (root.dataset.colorMode === "light" ? "#f8f5f0" : "#181714"),
    );
    root.style.setProperty("--color-primary", effective);
    root.style.setProperty(
      "--color-primary-content",
      contrastingText(effective),
    );
  } else {
    root.style.removeProperty("--color-primary");
    root.style.removeProperty("--color-primary-content");
  }
  for (const key of [
    "expandSidebarOnHover",
    "opaqueSidebar",
    "hideTopNavbar",
    "removeGenreSelector",
    "mediaBlurredBackground",
    "mediaCardGlass",
    "episodeCards",
    "hideEpisodeSummary",
    "hideEpisodeFilename",
    "smallerEpisodeCards",
  ] as const)
    root.dataset[key] = value[key] ? "on" : "off";
  root.dataset.mediaBannerSize = value.mediaBannerSize;
  root.dataset.mediaBannerAppearance = value.mediaBannerAppearance;
  root.dataset.hideSpoilers = settings.privacy.hideAnimeSpoilers ? "on" : "off";
  root.dataset.hideScores = settings.privacy.hideAudienceScores ? "on" : "off";
  if (value.backgroundColor) {
    root.style.setProperty("--color-base-100", value.backgroundColor);
    const foreground = contrastingText(value.backgroundColor);
    root.style.setProperty("--color-base-content", foreground);
    const toward = foreground === "#ffffff" ? "white" : "black";
    root.style.setProperty(
      "--color-base-200",
      `color-mix(in srgb, ${value.backgroundColor} 94%, ${toward})`,
    );
    root.style.setProperty(
      "--color-base-300",
      `color-mix(in srgb, ${value.backgroundColor} 84%, ${toward})`,
    );
  } else {
    root.style.removeProperty("--color-base-100");
    root.style.removeProperty("--color-base-content");
    root.style.removeProperty("--color-base-200");
    root.style.removeProperty("--color-base-300");
  }
  root.style.setProperty(
    "--workspace-background-opacity",
    String(value.backgroundOpacity),
  );
  root.style.setProperty("--banner-opacity", String(value.bannerOpacity));
  root.style.setProperty("--banner-position", value.bannerPosition);
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
