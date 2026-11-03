# Vestra Nova — Desktop

Nova is Vestra's Electron desktop application, with a React interface, native mpv playback, a C# provider worker and sandboxed JavaScript extensions. The supported packaged target is **Windows x64**.

## Repositories

| Project         | Location                                                | Responsibility                                                    |
| --------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| Nova            | [Vestra](https://github.com/amabee/Vestra), `apps/nova` | Desktop UI, playback, settings and releases                       |
| Backend and SDK | `apps/server`, `packages/` and `tests/` in Vestra       | Provider worker, extension sandbox, contracts and shared services |
| Foundry         | [Vestra Foundry](https://github.com/amabee/Foundry)     | Native extension sources, registry and extension publication      |
| Pulse           | [Vestra Pulse](https://github.com/amabee/Pulse)         | Mobile planning scaffold; no implemented mobile app yet           |

Nova remains in the Vestra repository so existing release and updater URLs continue to work. The existing documentation site is unchanged by the repository split.

## Implemented features

- Home, discovery, anime search/details, weekly schedule, films/series and manga browsing/reading.
- Local library scanning, saved lists, watch history, progress and episode/chapter completion records.
- Native playback controls, audio/subtitle selection, subtitle appearance, skip controls and source-supported quality choices.
- Extension browsing, permission review, installation and source diagnostics. Availability and playback depend on each upstream source; experimental listings are marked separately.
- Searchable settings for application behavior, appearance, playback, connections, library/scanning, diagnostics and updates.
- AniList browser sign-in from Settings or the account control at the bottom of the sidebar. Connected accounts show their avatar; account credentials and local list backups use OS-backed encrypted storage.
- An optional qBittorrent connection for category-scoped download management. Nova does not install qBittorrent or provide an embedded torrent engine.
- Stable Windows app updates through GitHub Releases, with manual checking, release notes, explicit download and restart/install actions.

This README describes the source on `main`. A published installer contains the source from its release tag; changes on `main` may await the next release.

## Development

Run these commands from the **Vestra repository root**. Use Node 22 or newer, pnpm 11.9.0 and the .NET 10 SDK. The .NET SDK is needed for backend development and packaging; installed Windows builds include their worker runtime.

```sh
pnpm install --frozen-lockfile
pnpm build:server
pnpm --filter @vestra/nova fetch:mpv
pnpm dev:nova
```

To build and run without the Vite development server:

```sh
pnpm --filter @vestra/nova build
pnpm --filter @vestra/nova start
```

For a change limited to one side:

```sh
pnpm --filter @vestra/nova build:electron
pnpm --filter @vestra/nova build:renderer
```

The Electron build includes the main process, extension worker, main-window preload and restricted player preload. Restart Electron after main-process or preload changes. Development renderer changes use Vite.

Optional service connections are configured through Settings or the repository's [.env.example](../../.env.example). Source-only development debugging is available through `pnpm --filter @vestra/nova start:debug`; packaged builds refuse the development debugging environment setting.

## Packaging

```sh
# Unpacked Windows application; fetch mpv first on a fresh checkout.
pnpm --filter @vestra/nova fetch:mpv
pnpm --filter @vestra/nova package:dir

# Local Windows installer, without publishing.
pnpm --filter @vestra/nova release:build
```

Outputs are under `apps/nova/release/`; compiled application code is under `dist-electron/` and `dist-renderer/`. Packaging publishes the self-contained C# worker and checks its manifest, runtime files and provider compiler. It also verifies the pinned Foundry snapshot before including bundled extensions.

[scripts/build-electron.mjs](scripts/build-electron.mjs) bundles workspace TypeScript through esbuild. Electron TypeScript configuration is typecheck-only. The build copies QuickJS's WASM and the provider compiler next to the main-process assets so packaged execution can resolve them.

## Foundry extensions

The canonical registry is:

```text
https://raw.githubusercontent.com/amabee/Foundry/main/extensions/registry.json
```

New profiles use Foundry. Updated Nova builds resolve the former official Vestra registry URL to Foundry while retaining saved registry origins. Custom URLs and explicitly empty lists remain unchanged. The previous registry file remains a compatibility mirror for older installed clients.

The root `extensions/` folder is a reviewed offline snapshot, not the canonical source-development location. [extensions.snapshot.json](../../extensions.snapshot.json) pins a Foundry commit and SHA-256 hashes. Existing installed extension IDs and permission grants are retained.

```sh
pnpm extensions:verify
pnpm extensions:update <reviewed-full-commit-sha>
pnpm test:foundry
```

Edit and build extension sources in Foundry, then update the snapshot after reviewing the upstream commit. Sync/update commands refuse to overwrite local snapshot edits; verification rejects changed, missing or extra files and unsafe paths. Packaging works from the verified local snapshot without downloading a moving branch.

StreamFlix remains excluded from Foundry's published registry and blocked in Nova's bundled install path. Vidlink remains experimental. Offline contract checks do not establish current upstream streaming availability.

## Security boundaries

- Main and player renderers use context isolation, sandboxing, disabled Node integration and a restrictive Content Security Policy.
- [electron/ipc-security.ts](electron/ipc-security.ts) authorizes registered WebContents, the exact trusted document and its main frame before privileged IPC handlers run.
- [electron/preload.ts](electron/preload.ts) exposes the main bridge. [electron/preload-overlay.ts](electron/preload-overlay.ts) exposes a smaller player surface without account/source management, settings writes or updater controls. Subframes receive neither bridge.
- Navigation, redirects, popups and webviews are constrained. Approved external links from the main window open in the system browser. Browser permission requests are denied by default.
- Community extension code runs in QuickJS isolates inside a utility process. Host calls are brokered by the main process using reviewed capabilities, host grants, rate limits and response/deadline limits.
- [electron/public-network.ts](electron/public-network.ts) validates DNS answers inside the socket lookup callback, preserving normal TLS hostname verification. Private addresses, including IPv4-mapped forms, are rejected; the guarded transport disables redirects and limits response bytes while reading.
- AniList and saved qBittorrent credentials use OS-backed encryption; plaintext fallback storage is refused. AniList sign-in validates a short-lived, single-use callback state. Exported list backups contain private list data but no account credentials.
- Packaged Electron fuses disable RunAsNode, Node options and Node inspector CLI flags, and enable ASAR-only loading with embedded integrity checking.

These controls and automated tests do not constitute a complete penetration test or guarantee that every upstream provider or native dependency is vulnerability-free.

## Updates and releases

The update feed remains [amabee/Vestra Releases](https://github.com/amabee/Vestra/releases). Installed Windows builds can check for stable releases; source and portable launches do not replace themselves through the updater. Downloads and restart/install remain explicit user actions; prereleases and downgrades are disabled.

[The release workflow](../../.github/workflows/nova-release.yml) builds on a matching stable version tag, runs application/security/Foundry checks, validates the installer and updater artifacts, and uploads a **draft** release. Publishing the reviewed draft is a separate step.

From the repository root:

```sh
pnpm release:version patch
```

Review and commit the version change, then create the corresponding `vX.Y.Z` tag when ready. Installer hashes, blockmap, version/path and embedded feed must pass validation before publication. Do not replace assets of an already-published version.

**Windows signing is currently deferred.** With no signing configuration, the workflow allows unsigned releases while keeping the remaining security and artifact checks enabled. Providing all three values below enables required signing and publisher verification; partial configuration fails the workflow:

| GitHub configuration       | Kind                | Purpose                                                            |
| -------------------------- | ------------------- | ------------------------------------------------------------------ |
| `CSC_LINK`                 | Secret              | Certificate input for the configured certificate-file signing path |
| `CSC_KEY_PASSWORD`         | Secret              | Certificate password                                               |
| `VESTRA_WINDOWS_PUBLISHER` | Repository variable | Expected publisher name                                            |

Cloud signing needs its own integration. Microsoft Store distribution has not been configured. Unsigned installers do not establish a trusted Windows publisher identity.

## Verification commands

Run checks appropriate to the files changed. Security and updater IPC checks use the built preloads; settings UI checks also use the built renderer stylesheet.

```sh
pnpm --filter @vestra/nova typecheck
pnpm --filter @vestra/nova build
pnpm test:security
pnpm test:foundry
pnpm test:anilist:login
pnpm test:settings:expansion
pnpm test:settings:integrations
pnpm test:settings:ui
pnpm test:updater
pnpm test:updater:ipc
```

After creating an unpacked Windows package:

```sh
node apps/nova/scripts/test-packaged-security.mjs
node apps/nova/scripts/test-packaged-worker.mjs --resources apps/nova/release/win-unpacked/resources
```

The package checks inspect the actual executable's fuse values, both preload assets, the worker and the bundled compiler. Tests that use fixtures or inspect exports do not replace a manual playback/login/update check of the final installer.
