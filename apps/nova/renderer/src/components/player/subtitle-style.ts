/**
 * Subtitle appearance the viewer picked, kept on this PC.
 *
 * Stored in local storage, like the other small viewer preferences, so the
 * font survives a restart and is put back on the player when it opens.
 */

const FONT_KEY = "vestra.subtitleFont";
const COLOR_KEY = "vestra.subtitleColor";
const FONT_NAME = /^[\p{L}\p{N} .'_\-]{1,64}$/u;
const COLOR = /^#[0-9a-fA-F]{6}$/;

/** The chosen subtitle colour as `#RRGGBB`, or `null` for white. */
export function getSubtitleColor(): string | null {
  try {
    const color = localStorage.getItem(COLOR_KEY);
    return color && COLOR.test(color) ? color.toUpperCase() : null;
  } catch {
    return null;
  }
}

export function saveSubtitleColor(color: string | null): void {
  try {
    if (color) localStorage.setItem(COLOR_KEY, color);
    else localStorage.removeItem(COLOR_KEY);
  } catch {
    // Storage can be unavailable; the choice then lasts for this session only.
  }
}

/** The chosen subtitle font, or `null` for the player's default. */
export function getSubtitleFont(): string | null {
  try {
    const family = localStorage.getItem(FONT_KEY)?.trim();
    return family && FONT_NAME.test(family) ? family : null;
  } catch {
    return null;
  }
}

export function saveSubtitleFont(family: string | null): void {
  try {
    if (family) localStorage.setItem(FONT_KEY, family);
    else localStorage.removeItem(FONT_KEY);
  } catch {
    // Storage can be unavailable; the choice then lasts for this session only.
  }
}
