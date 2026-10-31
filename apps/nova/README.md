# Vestra Nova — Desktop

The Vestra desktop app. It is an Electron app with three parts: the main process
(the back office that talks to the system), a secure preload bridge (the only
door between the window and the main process), and the renderer (the screens
you see, built with React).

## Status

| Piece | State |
| --- | --- |
| Main process, tray, single-instance lock | working |
| Preload bridge and IPC channels | working |
| Renderer (screens: home, anime search and details, player controls) | working |
| Extension sandbox (QuickJS in a utility process) | working |
| Local library scanning and playback | working |
| Auto-update | not started |

## Running

```bash
pnpm --filter @vestra/nova build   # build the main process, preload and renderer
pnpm --filter @vestra/nova start   # launch the app
```

Development mode, with the screens reloading as you save:

```bash
pnpm dev:nova
```

`pnpm --filter @vestra/nova package:dir` makes an unpacked folder you can run
without an installer. `pnpm --filter @vestra/nova package` makes a Windows
installer through electron-builder. Both put what they need in `release/` and
`dist-electron/`, including the QuickJS `.wasm` file. No `node_modules` are
shipped.

After changing code, rebuild the side you changed:

- Main process or preload: `pnpm --filter @vestra/nova build:electron`
- Screens: `pnpm --filter @vestra/nova build:renderer`

## Build

`scripts/build-electron.mjs` bundles with esbuild rather than `tsc`. Workspace
packages ship raw TypeScript with extensionless imports, so `tsc` would emit a
`require()` pointing at a `.ts` file Node cannot run. `tsconfig.electron.json`
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
  the network at all. Requests are relayed to the main process, which owns the
  permission grant and the host allow-list.
- Logs for failed requests name the site and the error type, but never the
  full web address, query values, cookies or tokens.

## Loading and retries

- Search results and episode lists are kept in memory for a few minutes
  ([electron/ttl-cache.ts](electron/ttl-cache.ts)). Failed or empty results are
  never kept.
- Two identical requests at the same time share one network call.
- Safe GET requests retry up to 2 times on temporary errors (dropped
  connection, timeout, DNS trouble, HTTP 429, 502, 503 or 504), waiting a
  little longer each time.
- The Quality list for an episode is fetched early, while the anime loads, so
  the gear menu opens without waiting.

## Next steps

1. **Animated loading.** Skeleton placeholders and transitions for search
   results are not built yet. The details page has grey loading blocks.
2. **Faster first video.** Starting a stream can still take a long time when
   an extension's requests are slow. Measure which request is slow first.
3. **Auto-update.** Wire `electron-updater` in `initAutoUpdate()`.
