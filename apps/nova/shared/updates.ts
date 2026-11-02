export type UpdatePhase =
  | "disabled"
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";
export interface AppUpdateState {
  phase: UpdatePhase;
  currentVersion: string;
  version: string | null;
  releaseNotes: string;
  lastCheckedAt: string | null;
  progress: {
    percent: number;
    transferred: number;
    total: number;
    bytesPerSecond: number;
  } | null;
  message: string | null;
}
