# Vestra Nova — Desktop

The Vestra desktop application. Electron main process, secure preload bridge,
tray, frameless window, and a sandboxed runtime for community extensions.

## Status

**There is no renderer application.** Nova previously loaded a Next.js app over
loopback; that app has been removed, and `electron/shell.html` is a placeholder
so the window has something to display. Everything beneath it works:

| Piece | State |
| --- | --- |
| Main process, tray, single-instance lock | working |
| Preload bridge, IPC channels | working |
| Extension isolates (QuickJS in a utility process) | working |
| Renderer application | **not started** |

Nova no longer runs an HTTP server or opens a port.

## Running

```bash
pnpm --filter @vestra/nova build   # bundle main, preload, worker
pnpm --filter @vestra/nova start   # launch
```

Development, with `NODE_ENV=development`:

```bash
pnpm dev:nova
```

`pnpm --filter @vestra/nova package` produces a distributable via
electron-builder. Everything it needs lives in `dist-electron/`, including the
QuickJS `.wasm` — no `node_modules` are shipped.

## Build

`scripts/build-electron.mjs` bundles with esbuild rather than `tsc`. Workspace
packages ship raw TypeScript with extensionless imports, so `tsc` would emit a
`require()` pointing at a `.ts` file Node cannot execute. `tsconfig.electron.json`
is therefore typecheck-only.

Two things the bundle has to correct for:

- esbuild rewrites ESM to CJS, which leaves `import.meta.url` undefined and
  breaks quickjs-emscripten's WASM lookup. A `define` plus a banner points it at
  the bundle's own path.
- The `.wasm` is copied next to the bundle, because emscripten resolves it
  relative to the module that loads it.

## Security model

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- The renderer only sees the allow-listed bridge in [electron/preload.ts](electron/preload.ts)
- Every IPC channel is explicitly registered in [electron/main.ts](electron/main.ts)
- External links open in the system browser; in-app navigation is blocked
- Extension isolates run in a `utilityProcess`, and that process cannot reach
  the network at all — requests are relayed to the main process, which owns the
  permission grant and the host allowlist

## Next steps

1. **A renderer.** Nothing displays until one exists, and it needs a framework
   decision first.
2. **Data over IPC.** `packages/*` already holds the providers, storage, scanner
   and matcher; they used to be reached over HTTP and now need IPC channels.
3. **Local library scanning** — walk `settings.library.folders`, filter by
   `settings.library.videoExtensions`, parse titles with `parseMediaFilename()`
   from `@vestra/core/filename`.
4. **Native playback** — a `<video>` surface fed by `file://` locators.
5. **Auto-update** — wire `electron-updater` in `initAutoUpdate()`.
