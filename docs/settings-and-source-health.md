# Settings, source health and torrent client setup

## Delivered

- [x] Playback/Shonen repairs committed and merged into `main` (`c8ac1b2`).
- [x] Session playback diagnostics with short errors, stage, code and bounded redacted detail.
- [x] Source runtime availability and the most recent stream-resolution result.
- [x] Explicit stable-version checks against matching native extension registries.
- [x] Settings redesign with User Interface as the default section.
- [x] Immediate persisted appearance across the main window and native player controls.
- [x] App start page and status-bar controls.
- [x] Playback controls, including configurable J/L and button seek steps.
- [x] Encrypted qBittorrent settings, connection test and category-scoped Downloads page.
- [x] Updater controller, UI and real Electron IPC/feed checks.
- [ ] Installed-version upgrade through a published release. There is no published Nova app release to upgrade from yet. Source runs remain excluded from self-updates.

## Design and references

The comparison was made against Seanime's [settings navigation](https://github.com/5rahim/seanime/blob/main/seanime-web/src/app/%28main%29/settings/page.tsx), [User Interface controls](https://github.com/5rahim/seanime/blob/main/seanime-web/src/app/%28main%29/settings/_containers/ui-settings.tsx) and [torrent-stream settings](https://github.com/5rahim/seanime/blob/main/seanime-web/src/app/%28main%29/settings/_containers/torrentstream-settings.tsx). The useful concepts are distinct App/UI sections, discoverable appearance controls and separate client/streaming configuration.

Vestra implements these concepts in its own components and existing warm dark palette, typography and geometry. It does not import Seanime implementation code. Settings uses a section navigator on larger screens and a horizontal navigator on narrow screens, with searchable section names. Controls are backed by live application behavior; no placeholder streaming toggles are presented.

## User Interface and App

Open **Settings → User Interface** for dark/light/system theme, accent presets, text size, navigation labels, blur and reduced motion. Theme previews are immediate after a successful save. Reset interface affects only appearance.

Previously unused accent preferences do not silently recolor existing profiles: `customizeAccent` defaults off, retaining Vestra vermillion until the user chooses a color. Old profiles gain the new App/UI defaults through the shared settings schema. The patch schema strips field defaults before making fields optional, so changing one control cannot reset another. Patches serialize the read/merge/write and notify both renderer windows only after persistence succeeds.

**App** controls the next launch's start page and the bottom status bar. Deep-linked startup destinations take priority over the configured start page. Source runs and installed builds share these preferences. Hardware-decoder changes apply when the native player restarts; restart Vestra after changing that option.

## Source health and playback diagnostics

Open **Settings → Diagnostics**, or expand source health in **Extensions**. Runtime loaded means the adapter is available; it does not prove a website or CDN is currently working. The most recent stream-resolution success/failure is recorded during real extraction. Expected caller cancellation does not replace an existing health observation. A resolution success does not claim that a complete episode played without buffering.

Check extension updates fetches registries only when requested. Comparisons require the same native extension ID and registry and a newer stable three-part version. Unknown/prerelease versions are not treated as stable updates. Compatibility imports keep their existing per-source update review. No update installs automatically.

Diagnostics keep at most 50 failures and 200 source observations in memory, with no persistence or automatic transmission. Reports redact URLs, Windows paths, bearer tokens and common credential fields and omit stack traces. **Copy report** copies local troubleshooting text; review it before sharing. Redaction is best effort for arbitrary provider-written error text.

## Torrents

1. Enable qBittorrent's Web User Interface in qBittorrent itself.
2. In **Settings → Torrents**, enter the Web UI URL, username and password.
3. Save, then use **Test connection**. The saved password is never returned to the renderer. Credentials use Electron safeStorage in `qbittorrent-credentials.enc`; environment credentials remain a fallback when the saved connection is removed.
4. Enable qBittorrent integration and choose a category (default `vestra`).
5. Open **Downloads** to add magnets/http(s) torrent URLs, view progress and speeds, and pause/resume transfers.

Only transfers in the configured category are listed or controlled, with host-side membership checks before actions. Existing unrelated client transfers are untouched. Polling runs only while Downloads is mounted and active, at the configured interval. Authentication sessions are scoped to the connection, so switching clients cannot reuse another client's cookie. qBittorrent's [Web UI API documentation](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-%28qBittorrent-5.0%29) is the protocol reference.

This is client integration, not an embedded BitTorrent engine. Torrent-provider search, sequential stream-while-downloading, cache quotas, seeding controls and completed-download auto-import need a separate implementation. Add your completed-download folder under Library to scan files with the existing library tools. No trackers, automatic downloads or client installation are added by this work.

## Verification

```powershell
pnpm test:settings
pnpm test:settings:ui
pnpm test:anime:repair
pnpm test:anime:buffering
pnpm test:anime
pnpm test:updater
pnpm test:updater:ui
pnpm test:updater:ipc
pnpm --filter @vestra/nova typecheck
pnpm --filter @vestra/nova build
```

Settings tests cover legacy-document defaults, concurrent patch preservation, disk-failure recovery, diagnostic redaction, encrypted credentials, corruption, connection isolation and category-restricted IPC. Hidden Electron tests exercise appearance, navigation, failed saves, Downloads actions, origin-matched update checks and subscription cleanup, with isolated profiles and mock client requests. No real torrents are added or installed-version upgrade claimed.
