import type { AppearanceSettings } from "@vestra/types";
export function mediaBannerPresentation(
  value: Pick<
    AppearanceSettings,
    "mediaBannerAppearance" | "glassEffects" | "mediaBannerSize"
  >,
  available: boolean,
) {
  const mode = value.mediaBannerAppearance;
  return {
    hidden: mode === "hide" || (mode === "hide-unavailable" && !available),
    blurred:
      value.glassEffects &&
      (mode === "blur" || (mode === "blur-available" && available)),
    dimmed: mode === "dim" || (mode === "dim-unavailable" && !available),
    size: value.mediaBannerSize,
  };
}
