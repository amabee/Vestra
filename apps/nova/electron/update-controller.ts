import type { AppUpdateState } from "../shared/updates";

export interface UpdateEngine {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}
function notes(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 6000);
  if (Array.isArray(value))
    return value
      .slice(0, 20)
      .map((row) => (typeof row?.note === "string" ? row.note : ""))
      .join("\n\n")
      .slice(0, 6000);
  return "";
}
function updateError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (
    code === "ERR_UPDATER_LATEST_VERSION_NOT_FOUND" ||
    code === "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND"
  )
    return "The update feed is not available yet. Try again after a release is published.";
  return "The update could not be completed. Check your connection and try again, or download the installer from Releases.";
}

/** Main-process state machine; no feed URLs, file paths or credentials cross IPC. */
export class UpdateController {
  private state: AppUpdateState;
  private listeners: Array<[string, (...args: any[]) => void]> = [];
  private busy = false;
  private disposed = false;
  private startup?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;
  constructor(
    private engine: UpdateEngine | null,
    version: string,
    private publish: (state: AppUpdateState) => void,
    disabledReason = "Updates are available in the installed Windows app. Source and portable runs do not replace themselves.",
  ) {
    this.state = {
      phase: engine ? "idle" : "disabled",
      currentVersion: version,
      version: null,
      releaseNotes: "",
      lastCheckedAt: null,
      progress: null,
      message: engine ? null : disabledReason,
    };
    if (!engine) return;
    engine.autoDownload = false;
    engine.autoInstallOnAppQuit = false;
    engine.allowPrerelease = false;
    engine.allowDowngrade = false;
    const on = (event: string, listener: (...args: any[]) => void) => {
      engine.on(event, listener);
      this.listeners.push([event, listener]);
    };
    on("update-available", (info) =>
      this.set({
        phase: "available",
        version: String(info.version).slice(0, 60),
        releaseNotes: notes(info.releaseNotes),
        progress: null,
        message: null,
        lastCheckedAt: new Date().toISOString(),
      }),
    );
    on("update-not-available", () =>
      this.set({
        phase: "current",
        version: null,
        releaseNotes: "",
        progress: null,
        message: null,
        lastCheckedAt: new Date().toISOString(),
      }),
    );
    on("download-progress", (progress) => {
      if (this.state.phase !== "downloading") return;
      const number = (value: unknown) =>
        typeof value === "number" && Number.isFinite(value)
          ? Math.max(0, value)
          : 0;
      this.set({
        progress: {
          percent: Math.min(100, number(progress.percent)),
          transferred: number(progress.transferred),
          total: number(progress.total),
          bytesPerSecond: number(progress.bytesPerSecond),
        },
      });
    });
    on("update-downloaded", (info) =>
      this.set({
        phase: "downloaded",
        version: String(info.version).slice(0, 60),
        progress: null,
        message: null,
      }),
    );
    on("error", (error) =>
      this.set({ phase: "error", progress: null, message: updateError(error) }),
    );
  }
  snapshot(): AppUpdateState {
    return structuredClone(this.state);
  }
  private set(patch: Partial<AppUpdateState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.publish(this.snapshot());
  }
  start(initialDelayMs = 30000) {
    if (!this.engine || this.startup || this.interval || this.disposed) return;
    this.startup = setTimeout(() => {
      void this.check();
    }, initialDelayMs);
    this.interval = setInterval(
      () => {
        void this.check();
      },
      6 * 60 * 60 * 1000,
    );
    this.startup.unref();
    this.interval.unref();
  }
  async check(): Promise<AppUpdateState> {
    if (
      !this.engine ||
      this.busy ||
      this.disposed ||
      ["downloading", "downloaded", "installing"].includes(this.state.phase)
    )
      return this.snapshot();
    this.busy = true;
    this.set({ phase: "checking", message: null, progress: null });
    try {
      const result = await this.engine.checkForUpdates();
      if (result === null && this.state.phase === "checking")
        this.set({
          phase: "error",
          message: "Updates are unavailable for this installation.",
        });
    } catch (error) {
      this.set({ phase: "error", message: updateError(error) });
    } finally {
      this.busy = false;
    }
    return this.snapshot();
  }
  async download(): Promise<AppUpdateState> {
    if (
      !this.engine ||
      this.disposed ||
      this.busy ||
      !(
        this.state.phase === "available" ||
        (this.state.phase === "error" && this.state.version)
      )
    )
      return this.snapshot();
    this.busy = true;
    this.set({
      phase: "downloading",
      message: null,
      progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
    });
    try {
      await this.engine.downloadUpdate();
    } catch (error) {
      this.set({ phase: "error", progress: null, message: updateError(error) });
    } finally {
      this.busy = false;
    }
    return this.snapshot();
  }
  install(): AppUpdateState {
    if (
      !this.engine ||
      this.disposed ||
      this.busy ||
      this.state.phase !== "downloaded"
    )
      return this.snapshot();
    this.set({ phase: "installing", message: null });
    try {
      this.engine.quitAndInstall(false, true);
    } catch (error) {
      this.set({ phase: "error", message: updateError(error) });
    }
    return this.snapshot();
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.startup);
    clearInterval(this.interval);
    for (const [event, listener] of this.listeners)
      this.engine?.removeListener(event, listener);
    this.listeners = [];
  }
}
