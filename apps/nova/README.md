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

- A mascot startup splash shows settings, saved-data hydration, installed sources and the app update check before opening Nova. Slow sources and update checks continue in the background; updates still require explicit download and installation. Animation can be paused and respects reduced-motion settings.
- Home, discovery, anime search/details, weekly schedule, films/series and manga browsing/reading. Manga search queries all enabled sources, presents cards without extension badges, loads more results as you scroll and combines Continue Reading across extensions. Catalogue titles check available reading editions before opening source-specific chapters.
- Continue Reading opens the saved manga chapter/page directly. Catalogue reading sources are remembered per title; selecting an edition opens the reader in one click. Reader failures offer image retry, chapter refresh and source changes without returning to the library. Saved-progress errors and missing chapters require recovery or an explicit chapter choice before recording a new position.
- Playback retries retain the last confirmed position. The failure screen links directly to source selection; anime recovery carries the numbered episode and season and resumes only when the replacement source contains that exact episode.
- Local library scanning, saved lists, watch history, progress and episode/chapter completion records.
- Native playback controls, audio/subtitle selection, subtitle appearance, skip controls and source-supported quality choices.
- Extension browsing, permission review, installation, reviewed updates and source diagnostics. Availability and playback depend on each upstream source; experimental listings are marked separately.
- Movies/Series provider switching recognizes parenthesized release years while rejecting wrong remakes and ambiguous matches. Source failures link to the provider's browse page. Report problem opens a GitHub issue draft with the app version, source and public error code; raw errors and credentials are excluded.
- Searchable settings for application behavior, appearance, playback, connections, library/scanning, diagnostics and updates.
- AniList browser sign-in from Settings or the account control at the bottom of the sidebar. Connected accounts show their avatar; account credentials and local list backups use OS-backed encrypted storage.
- Connected AniList accounts sync anime watchlists and manga reading shelves in both directions. List additions, status changes and completed episode/numbered-chapter progress queue automatically; the queue and incoming list snapshot are encrypted per account. Settings shows pending work, retries, unmatched titles and a manual sync action. Anime and manga details include AniList status controls.
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

In Extensions, **Check for updates** checks installed SDK extensions and compatibility sources. Review updates before applying them; newly requested permissions start unchecked and additional hosts are highlighted. Reviewed code is pinned in memory, enabled/disabled status is retained, and activation or storage failures attempt to restore the previous runtime. Existing bundled installs are matched by their shipped manifest path before checking Foundry; arbitrary local folders have no automatic remote origin.

The reviewed offline catalogue includes all 17 native anime ports and 23 native manga sources from Foundry, alongside the existing movie/TV sources. Anime listings use the Anime filter and manga listings use Manga. Installing a source still requires permission review; bundling never installs it automatically.

SDK 1.7 adds a separate `network:cookies` permission for source-issued anonymous cookies and follows redirects only within exact approved HTTPS hosts. Browser/account cookie jars remain unavailable. Timed-out host requests release their sandbox handles when unloaded. These changes require a Nova build newer than v0.2.7.

Native HentaiEra and experimental Hentai2Read adapters are maintained in Foundry. SDK 1.6 adds optional `searchPage(query, { page, limit })` returning `{ items, hasMore }`; older `search` arrays remain supported. Nova detects repeated pages from legacy providers so infinite scrolling does not repeatedly append the first page.

Registry URLs may point to an array, an `extensions`/`entries` array wrapper, or one extension manifest. Seanime JavaScript/TypeScript anime and manga manifests can embed their script in `payload` or link it through `payloadURI`. Host access still requires review. Unsupported types and languages remain visible with an explanation; listing an extension does not establish upstream compatibility or availability.

**Settings → Application → Anime preferences → Enable adult content** controls AniList anime search and anime/manga catalogue discovery and metadata. When enabled, the `isAdult` filter is omitted; an explicit `null` returns an empty AniList catalogue. Switching the setting changes the query and cache; individual source feeds may enforce their own restrictions.

The root `extensions/` folder is a reviewed offline snapshot, not the canonical source-development location. [extensions.snapshot.json](../../extensions.snapshot.json) pins a Foundry commit and SHA-256 hashes. Existing installed extension IDs and permission grants are retained.

```sh
pnpm extensions:verify
pnpm extensions:update <reviewed-full-commit-sha>
pnpm test:foundry
```

Edit and build extension sources in Foundry, then update the snapshot after reviewing the upstream commit. Sync/update commands refuse to overwrite local snapshot edits; verification rejects changed, missing or extra files and unsafe paths. Packaging works from the verified local snapshot without downloading a moving branch.

StreamFlix remains excluded from Foundry's published registry and blocked in Nova's bundled install path. Vidlink, AnimeGG, AnimeToast, DonghuaStream and AniTVPlus remain experimental; additional manga sources also have upstream restrictions recorded in Foundry. Offline contract checks do not establish current upstream streaming availability.

## Security boundaries

- Main and player renderers use context isolation, sandboxing, disabled Node integration and a restrictive Content Security Policy.
- [electron/ipc-security.ts](electron/ipc-security.ts) authorizes registered WebContents, the exact trusted document and its main frame before privileged IPC handlers run.
- [electron/preload.ts](electron/preload.ts) exposes the main bridge. [electron/preload-overlay.ts](electron/preload-overlay.ts) exposes a smaller player surface without account/source management, settings writes or updater controls. Subframes receive neither bridge.
- Navigation, redirects, popups and webviews are constrained. Approved external links from the main window open in the system browser. Browser permission requests are denied by default.
- Renderer queries and mutations use IPC regardless of Chromium's online/offline hint. Discovery shows catalogue and settings failures with retry actions.
- Compatibility manga providers run in separate workers (up to four resident workers) with a 30-second script budget and a 35-second host watchdog. Reading progress/bookmarks keep a separate storage worker. Image requests preserve source headers and supply missing browser headers/referrers; image errors include the source and host. An HTTP 403 from an upstream site may still require a source update or session.
- Community extension code runs in QuickJS isolates inside a utility process. Host calls are brokered by the main process using reviewed capabilities, host grants, rate limits and response/deadline limits.
- [electron/public-network.ts](electron/public-network.ts) validates DNS answers inside the socket lookup callback, preserving normal TLS hostname verification. Private addresses, including IPv4-mapped forms, are rejected; the guarded transport disables redirects and limits response bytes while reading.
- AniList and saved qBittorrent credentials use OS-backed encryption; plaintext fallback storage is refused. AniList sign-in validates a short-lived, single-use callback state. Exported list backups contain private list data but no account credentials.
- Packaged Electron fuses disable RunAsNode, Node options and Node inspector CLI flags, and enable ASAR-only loading with embedded integrity checking.

These controls and automated tests do not constitute a complete penetration test or guarantee that every upstream provider or native dependency is vulnerability-free.

## AniList list sync

Connecting an account imports its anime and manga list snapshot into the Watchlist and manga Bookmarks views. Refreshes run while Nova is open, normally every five minutes; Settings → Application → Local account & AniList includes **Sync AniList now**, pending counts and retry details. Disconnecting removes the token, pending queue and imported snapshot from the active account without deleting local library data or existing backups.

Watchlist statuses map to AniList planning/current/completed/paused/dropped. Playlist additions ensure the title exists on AniList without replacing its existing status; playlist names and order remain local. Manga bookmarks add a title to planning, and anime/manga information pages expose explicit AniList status controls. Removing a watchlist/reading-shelf title removes its AniList list entry. Removing a title from a named playlist only changes that local playlist.

Completed episodes and integer-numbered chapters advance AniList progress; automatic updates preserve higher remote progress and mark completed only when AniList supplies a known total. Page positions, per-chapter completion flags and local episode history stay local; imported remote counts do not fabricate local playback positions. Scores, notes, privacy and custom-list memberships are preserved. Provider-only titles require one unique exact title/alias match, or a source selected from a known AniList catalogue title; ambiguous matches remain pending for review instead of writing to a guessed title.

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
