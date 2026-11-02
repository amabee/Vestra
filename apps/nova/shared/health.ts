import type { PlaybackErrorCode } from "./playback-errors";
export interface PlaybackDiagnostic {
  id: number;
  at: string;
  stage: string;
  code: PlaybackErrorCode;
  detail: string;
  sourceId?: string;
}
export interface SourceObservation {
  state: "resolved" | "failed";
  at: string;
  durationMs: number;
  code?: PlaybackErrorCode;
}
export interface SourceHealth {
  id: string;
  name: string;
  enabled: boolean;
  loaded: boolean;
  kind: "native" | "compatibility" | "service";
  version?: string;
  needsReview?: boolean;
  observation?: SourceObservation;
}
