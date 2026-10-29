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
  remote?: { manifestUrl: string; version: string; sha256: string };
  versions: { id: string; version: string; sourceHash: string }[];
}
export interface RemoteSourcePlan {
  token: string;
  id: string;
  name: string;
  type: SourceOptions["type"];
  version: string;
  currentVersion?: string;
  manifestUrl: string;
  payloadUrl: string;
  sha256: string;
  checksumVerified: boolean;
  hosts: string[];
  addedHosts: string[];
  updating: boolean;
  changed: boolean;
}
export interface PickedSource {
  token: string;
  filename: string;
  bytes: number;
  sha256: string;
}
