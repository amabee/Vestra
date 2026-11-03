import type { MediaItem, PlaybackSource } from "@vestra/types";

const safePosition = (value: number | null | undefined) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 360000
    ? value
    : 0;
/** Idle/error notifications may reset mpv's clock. Keep the last clock from this playback only. */
export class PlaybackCheckpoint {
  private session = -1;
  private position = 0;
  observe(
    session: number,
    position: number,
    ready: boolean,
    start: number | null,
  ) {
    if (session !== this.session) {
      this.session = session;
      this.position = safePosition(start);
    }
    if (
      ready &&
      Number.isFinite(position) &&
      position >= 0 &&
      position <= 360000
    )
      this.position = position;
  }
  read(session: number, fallback: number | null) {
    return this.session === session ? this.position : safePosition(fallback);
  }
}
export function playbackSourceLink(
  item: MediaItem,
  source: PlaybackSource | undefined,
  position: number,
) {
  const params = new URLSearchParams({ chooseSource: "1" });
  if (
    item.kind === "anime" &&
    Number.isInteger(source?.episode) &&
    source!.episode! > 0
  ) {
    params.set("resumeEpisode", String(source!.episode));
    params.set("resumeSeason", String(source?.season ?? 1));
    params.set("resumeAt", String(safePosition(position)));
  }
  return `/media/${encodeURIComponent(item.source)}/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.sourceId)}?${params}`;
}
export function sourceRecoveryResume(
  params: URLSearchParams,
  queue: PlaybackSource[],
) {
  const episode = Number(params.get("resumeEpisode")),
    season = Number(params.get("resumeSeason") ?? "1"),
    position = Number(params.get("resumeAt") ?? "0");
  if (
    !params.has("resumeEpisode") ||
    !Number.isInteger(episode) ||
    episode < 1 ||
    episode > 10000 ||
    !Number.isInteger(season) ||
    season < 0 ||
    !Number.isFinite(position) ||
    position < 0 ||
    position > 360000
  )
    return null;
  const index = queue.findIndex(
    (row) => row.episode === episode && (row.season ?? 1) === season,
  );
  return index >= 0 ? { index, startAt: position } : null;
}
