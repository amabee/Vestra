export interface AniListAccountStatus {
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
}
