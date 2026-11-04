import {
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type Session,
  type WebContents,
} from "electron";

type WindowRole = "main" | "player" | "splash";
export const SPLASH_CHANNELS = new Set([
  "startup:state",
  "startup:continue",
  "startup:retry",
  "startup:quit",
]);
const trustedWindows = new WeakMap<
  WebContents,
  { role: WindowRole; document: string }
>();
const lockedSessions = new WeakSet<Session>();

/** Player controls may read preferences and operate playback, never manage accounts or sources. */
export const PLAYER_CHANNELS = new Set([
  "settings:get",
  "window:set-fullscreen",
  "window:is-fullscreen",
  "mpv:subscribe",
  "mpv:play",
  "mpv:pause",
  "mpv:seek",
  "mpv:seek-by",
  "mpv:set-volume",
  "mpv:set-muted",
  "mpv:set-speed",
  "mpv:select-track",
  "mpv:set-subtitle-font",
  "mpv:set-subtitle-color",
  "mpv:set-subtitle-delay",
  "mpv:set-subtitle-scale",
  "mpv:set-subtitle-visible",
  "player:get-now-playing",
  "player:command",
  "player:focus",
  "player:drag",
  "player:toggle-maximize",
  "player:set-interactive",
  "player:set-quality",
  "playback:qualities",
  "media:report-skip",
  "subtitle-fonts:search",
  "subtitle-fonts:install",
  "subtitle-fonts:installed",
]);

export function isTrustedDocument(actual: string, expected: string): boolean {
  try {
    const url = new URL(actual);
    url.hash = "";
    return url.href === new URL(expected).href;
  } catch {
    return false;
  }
}

export function assertTrustedSender(
  event: IpcMainInvokeEvent,
  channel: string,
): void {
  const policy = trustedWindows.get(event.sender);
  if (
    !policy ||
    event.sender.isDestroyed() ||
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame ||
    !isTrustedDocument(event.senderFrame.url, policy.document) ||
    (policy.role === "player" && !PLAYER_CHANNELS.has(channel)) ||
    (policy.role === "splash" && !SPLASH_CHANNELS.has(channel))
  ) {
    throw new Error("This request is not permitted from this window.");
  }
}

/** Every application IPC registration goes through the same caller check, before its handler runs. */
export function handleIpc(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => any,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event, channel);
    return listener(event, ...args);
  });
}

export function secureWindow(
  window: BrowserWindow,
  role: WindowRole,
  document: string,
): void {
  const contents = window.webContents;
  trustedWindows.set(contents, { role, document: new URL(document).href });
  const openExternal = (url: string) => {
    if (role !== "main") return;
    try {
      const target = new URL(url);
      if (
        (target.protocol === "https:" || target.protocol === "http:") &&
        !target.username &&
        !target.password
      )
        void shell.openExternal(target.href).catch(() => undefined);
    } catch {
      /* Invalid URLs are denied. */
    }
  };
  const denyNavigation = (event: { preventDefault(): void }) =>
    event.preventDefault();
  contents.on("will-navigate", (event, url) => {
    if (!isTrustedDocument(url, document)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  contents.on("will-redirect", denyNavigation);
  contents.on("will-attach-webview", denyNavigation);
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  const session = contents.session;
  if (!lockedSessions.has(session)) {
    session.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    session.setPermissionCheckHandler(() => false);
    lockedSessions.add(session);
  }
  contents.once("destroyed", () => trustedWindows.delete(contents));
}
