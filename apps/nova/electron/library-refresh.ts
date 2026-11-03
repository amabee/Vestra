import { getSettings } from "@vestra/storage";
import { scanLibrary, matchLibrary } from "@vestra/providers";
import { BrowserWindow } from "electron";
import { getDriver, getProviderRegistry } from "./services";

let running: ReturnType<typeof performScan> | null = null;
async function performScan() {
  const driver = getDriver();
  const settings = await getSettings(driver);
  const scan = await scanLibrary(driver, settings.library);
  const match =
    settings.library.autoMatchMetadata && scan.added > 0
      ? await matchLibrary(driver, getProviderRegistry())
      : { matched: 0, unmatched: 0 };
  for (const window of BrowserWindow.getAllWindows())
    window.webContents.send("library:changed");
  return {
    scanned: scan.scanned,
    added: scan.added,
    removed: scan.removed,
    errors: scan.errors,
    matched: match.matched,
    unmatched: match.unmatched,
  };
}
/** All entry points share one scan, including metadata matching. */
export function refreshLocalLibrary() {
  if (!running)
    running = performScan().finally(() => {
      running = null;
    });
  return running;
}
/** Poll only cheap directory metadata; full discovery runs when a root changes. */
export function startLibraryRefresh() {
  let busy = false;
  let previous = "";
  const tick = async (startup: boolean) => {
    if (busy) return;
    busy = true;
    try {
      const settings = await getSettings(getDriver());
      if (
        startup ? settings.library.scanOnStartup : settings.library.autoRefresh
      ) {
        const { stat } = await import("node:fs/promises");
        const signature = JSON.stringify(
          await Promise.all(
            settings.library.folders
              .filter((f) => f.enabled)
              .map(async (f) => {
                try {
                  const value = await stat(f.path);
                  return [f.path, value.mtimeMs];
                } catch {
                  return [f.path, null];
                }
              }),
          ),
        );
        if (startup || signature !== previous) await refreshLocalLibrary();
        previous = signature;
      }
    } catch (error) {
      console.warn("[library] Automatic refresh failed", error);
    } finally {
      busy = false;
    }
  };
  void tick(true);
  const timer = setInterval(() => void tick(false), 60000);
  timer.unref();
  return () => clearInterval(timer);
}
