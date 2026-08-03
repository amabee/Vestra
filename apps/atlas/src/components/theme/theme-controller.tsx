"use client";

import { ACCENT_TOKENS } from "@vestra/config/constants";
import type { AccentPreset, ThemeMode } from "@vestra/types";
import { useEffect } from "react";

/**
 * Applies theme and accent to the document root.
 *
 * Mounted from the settings page and from a small bootstrap in the shell, so a
 * change takes effect immediately without a reload.
 */

export function applyTheme(theme: ThemeMode): void {
  const root = document.documentElement;

  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : theme;

  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

export function applyAccent(accent: AccentPreset): void {
  const tokens = ACCENT_TOKENS[accent];
  if (!tokens) return;

  const root = document.documentElement;
  for (const [property, value] of Object.entries(tokens.vars)) {
    root.style.setProperty(property, value);
  }
}

export function ThemeController({
  theme,
  accent,
  glassEffects = true,
}: {
  theme: ThemeMode;
  accent: AccentPreset;
  glassEffects?: boolean;
}) {
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  useEffect(() => {
    document.documentElement.classList.toggle("no-glass", !glassEffects);
  }, [glassEffects]);

  // Follow the OS when the user chose "system".
  useEffect(() => {
    if (theme !== "system") return;

    const query = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme("system");

    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [theme]);

  return null;
}
