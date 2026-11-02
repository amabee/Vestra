import { playbackIssue } from "../shared/playback-errors";
import type { PlaybackDiagnostic, SourceObservation } from "../shared/health";
/** Session-only and bounded. Never stores stream locators, titles, headers or raw stack traces. */
export class PlaybackDiagnostics {
  private sequence = 0;
  private rows: PlaybackDiagnostic[] = [];
  private observations = new Map<string, SourceObservation>();
  failure(
    stage: string,
    error: unknown,
    sourceId?: string,
  ): PlaybackDiagnostic {
    const issue = playbackIssue(error);
    const text = error instanceof Error ? error.message : String(error);
    const detail = text
      .replace(/https?:\/\/[^\s"'<>]+/gi, "[video URL]")
      .replace(/[A-Za-z]:[\\/][^\r\n"'<>]+/g, "[local path]")
      .replace(/(?:Bearer\s+)[^\s]+/gi, "Bearer [redacted]")
      .replace(
        /["']?(?:token|password|authorization|cookie|api[-_]?key|signature|secret)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
        "[credential redacted]",
      )
      .split("\n")[0]!
      .slice(0, 350);
    const row = {
      id: ++this.sequence,
      at: new Date().toISOString(),
      stage,
      code: issue.code,
      detail,
      ...(sourceId ? { sourceId } : {}),
    };
    this.rows.push(row);
    this.rows = this.rows.slice(-50);
    return row;
  }
  observe(sourceId: string, started: number, error?: unknown): void {
    if (error instanceof Error && error.name === "AbortError") return;
    const row: SourceObservation = {
      state: error === undefined ? "resolved" : "failed",
      at: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - started),
      ...(error === undefined ? {} : { code: playbackIssue(error).code }),
    };
    this.observations.delete(sourceId);
    this.observations.set(sourceId, row);
    if (this.observations.size > 200)
      this.observations.delete(this.observations.keys().next().value!);
  }
  observation(id: string) {
    const row = this.observations.get(id);
    return row ? { ...row } : undefined;
  }
  list() {
    return this.rows.map((row) => ({ ...row })).reverse();
  }
}
export const playbackDiagnostics = new PlaybackDiagnostics();
