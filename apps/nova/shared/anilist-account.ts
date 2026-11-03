export interface AniListLoginState {
  configured: boolean;
  phase: "idle" | "waiting" | "connecting" | "error";
  message: string | null;
}
export interface AniListAccountStatus {
  login?: AniListLoginState;
  connected: boolean;
  user: { id: number; name: string; avatar: string | null; url: string } | null;
  encryptionAvailable: boolean;
  needsReconnect: boolean;
  loadError: boolean;
  backingUp: boolean;
  lastBackupAt: number | null;
  lastBackupError: string | null;
  nextBackupAttemptAt: number | null;
  backupCount: number;
  sync?: {
    pending: number;
    syncing: boolean;
    lastSyncAt: number | null;
    lastError: string | null;
    retryAt: number | null;
    unmatched: number;
  };
}
