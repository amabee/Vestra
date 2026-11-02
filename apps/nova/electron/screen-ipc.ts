import { ipcMain } from "electron";
import { getHistory, getWatchlist } from "@vestra/storage";
import { mediaDetailsSchema, type MediaRef } from "@vestra/types";
import { ScreenService } from "./screen-service";
import { getDriver, getStreamSourceRegistry } from "./services";

let service: ScreenService | undefined;
export function getScreenService() {
  return (service ??= new ScreenService(getStreamSourceRegistry()));
}
export async function screenSnapshot(ref: MediaRef) {
  if (ref.kind !== "movie" && ref.kind !== "tv") return null;
  const known = getScreenService().remembered(ref);
  const source = getStreamSourceRegistry().get(ref.source);
  if (
    source?.catalogueDetails &&
    getStreamSourceRegistry().isEnabled(source.id)
  ) {
    try {
      return await source.catalogueDetails(ref.sourceId);
    } catch (error) {
      if (!known) throw error;
    }
  }
  if (known) return mediaDetailsSchema.parse(known);
  const matches = (row: { ref: MediaRef }) =>
    row.ref.source === ref.source &&
    row.ref.sourceId === ref.sourceId &&
    row.ref.kind === ref.kind;
  const saved =
    (await getWatchlist(getDriver())).find(matches)?.snapshot ??
    (await getHistory(getDriver())).find(matches)?.snapshot;
  return saved ? mediaDetailsSchema.parse(saved) : null;
}
export function registerScreenIpc() {
  ipcMain.handle("screen:sources", (_e, kind) => getScreenService().list(kind));
  ipcMain.handle("screen:browse", (_e, query) =>
    getScreenService().load(query),
  );
}
