/** Presentation helpers shared by every Vestra surface. */

/** `7245` → `2h 45m`; `185` → `3m 5s`. */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;

  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return secs > 0 && minutes < 10 ? `${minutes}m ${secs}s` : `${minutes}m`;
  return `${secs}s`;
}

/** Zero-padded clock format for the player: `1:02:05` or `4:09`. */
export function formatTimecode(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "0:00";

  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const paddedSecs = String(secs).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSecs}`;
  return `${minutes}:${paddedSecs}`;
}

/** Vestra stores 0–100 internally but displays the familiar 0–10 scale. */
export function formatRating(score: number | null | undefined): string | null {
  if (score === null || score === undefined || score <= 0) return null;
  return (score / 10).toFixed(1);
}

export function formatVotes(votes: number | null | undefined): string | null {
  if (!votes || votes <= 0) return null;
  if (votes >= 1_000_000) return `${(votes / 1_000_000).toFixed(1)}M`;
  if (votes >= 1_000) return `${(votes / 1_000).toFixed(1)}K`;
  return String(votes);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / Math.pow(1024, exponent);

  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatSpeed(bytesPerSecond: number | null | undefined): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return "—";
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** Coarse relative time. Intl.RelativeTimeFormat keeps this locale-aware. */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const deltaSeconds = Math.round((timestamp - now) / 1000);
  const absolute = Math.abs(deltaSeconds);

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  const thresholds: [limit: number, divisor: number, unit: Intl.RelativeTimeFormatUnit][] = [
    [60, 1, "second"],
    [3600, 60, "minute"],
    [86_400, 3600, "hour"],
    [604_800, 86_400, "day"],
    [2_629_800, 604_800, "week"],
    [31_557_600, 2_629_800, "month"],
  ];

  for (const [limit, divisor, unit] of thresholds) {
    if (absolute < limit) {
      return formatter.format(Math.round(deltaSeconds / divisor), unit);
    }
  }

  return formatter.format(Math.round(deltaSeconds / 31_557_600), "year");
}

/** ETA in seconds → `12m`, `1h 5m`, or `—` when unknown. */
export function formatEta(seconds: number | null | undefined): string {
  return formatDuration(seconds) ?? "—";
}

/** Clamp to a whole percentage for progress bars. */
export function toPercent(fraction: number): number {
  return Math.round(Math.min(1, Math.max(0, fraction)) * 100);
}

/** Trim to a word boundary, appending an ellipsis when cut. */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(" ");
  return `${slice.slice(0, lastSpace > 0 ? lastSpace : maxLength).trimEnd()}…`;
}
