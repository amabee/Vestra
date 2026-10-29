export interface SourceOptions {
  id: string;
  name: string;
  type: "onlinestream-provider" | "manga-provider";
  hosts: string[];
  preferences: Record<string, unknown>;
  compatibility?: "animesaturn-nested-player-v1";
  preferredServer?: string;
}
export interface SourceSummary extends SourceOptions {
  sourceHash: string;
  enabled: boolean;
  status: "ready" | "disabled" | "error";
  error?: string;
  checkedAt?: string;
  servers?: string[];
}
export interface PickedSource {
  token: string;
  filename: string;
  bytes: number;
  sha256: string;
}
