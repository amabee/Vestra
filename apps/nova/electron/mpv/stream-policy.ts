/** Read ahead without requiring the whole cache to fill before the first frame. */
export const STREAM_CACHE_ARGS = [
  "--cache=auto",
  "--cache-secs=120",
  "--demuxer-max-bytes=256MiB",
  "--demuxer-max-back-bytes=32MiB",
  "--cache-pause=yes",
  "--cache-pause-initial=no",
  "--cache-pause-wait=1",
  "--network-timeout=8",
];

export const AUTO_HLS_BITRATE = 8_000_000;
export const RECOVERY_HLS_BITRATE = 3_000_000;
export const STALL_RECOVERY_MS = 12_000;

export const AUTO_HEIGHT = 1080;
export const RECOVERY_HEIGHT = 720;

/** Prefer 1080p for automatic playback; explicit quality choices remain exact. */
export function automaticVariant<T extends { label: string }>(
  rows: T[],
  maximumHeight = AUTO_HEIGHT,
): T {
  const numbered = rows
    .map((row) => ({
      row,
      height: Number(/\b(\d{3,4})p\b/i.exec(row.label)?.[1]),
    }))
    .filter((row) => row.height > 0)
    .sort((a, b) => a.height - b.height);
  const targetHeight =
    numbered.filter((row) => row.height <= maximumHeight).at(-1)?.height ??
    numbered[0]?.height;
  // Keep provider ordering when mirrors offer the same resolution.
  return numbered.find((row) => row.height === targetHeight)?.row ?? rows[0]!;
}
