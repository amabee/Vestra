# Vestra Nova — Desktop

Electron shell for Vestra. Nova renders **Vestra Atlas** and adds the
capabilities a browser cannot provide: local folder scanning, filesystem
playback, a tray icon and a frameless window.

## Status

The Electron shell is implemented (secure preload, frameless window, tray,
single-instance lock, auto-update hook). Local library scanning is the next
piece of work — see below.

## Running

Nova has no renderer of its own — it loads Atlas over HTTP. One command starts
both, from the repo root:

```bash
pnpm dev:nova
```

Turborepo runs Atlas and Nova in parallel; Nova's `dev` script blocks on
`wait-on tcp:127.0.0.1:3000` until the Atlas dev server is listening, then
compiles the Electron sources and launches the window.

If Atlas is *already* running in another terminal, skip the wait:

```bash
pnpm --filter @vestra/nova dev:electron
```

`pnpm --filter @vestra/nova package` produces a distributable via
electron-builder.

## Security model

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- The renderer only sees the allow-listed bridge in [electron/preload.ts](electron/preload.ts)
- Every IPC channel is explicitly registered in [electron/main.ts](electron/main.ts)
- External links open in the system browser; cross-origin navigation is blocked

## Custom title bar

The window is frameless. Atlas's top bar carries the `drag-region` utility class
(defined in `@vestra/tailwind`), which maps to `-webkit-app-region: drag`.
Interactive controls inside it use `no-drag`.

## Next steps

1. **Local library scanning** — walk the folders in `settings.library.folders`,
   filter by `settings.library.videoExtensions`, and parse titles with
   `parseMediaFilename()` from `@vestra/core/filename`.
2. **Thumbnails** — generate posters with ffmpeg for scanned files.
3. **Native playback** — a `<video>` surface fed by `file://` locators.
4. **Data directory** — point `@vestra/storage` at `app.getPath("userData")`
   via the `app:data-dir` IPC channel so Nova and Atlas don't share a store.
5. **Auto-update** — wire `electron-updater` in `initAutoUpdate()`.
