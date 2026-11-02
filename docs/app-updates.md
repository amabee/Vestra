# Nova app updates and releases

Nova uses electron-updater with a Windows x64 NSIS installer and the public [amabee/Vestra Releases](https://github.com/amabee/Vestra/releases) feed. Stable semantic versions support patch, minor and major updates. Prereleases and downgrades are disabled.

## In the app

Open **Settings → App updates** to check, download, view release notes and restart to install. An indicator appears in the status bar when an update is available or downloaded. Checks run 30 seconds after startup and every six hours while the app stays open. Manual checks remain available, including when a previous update is offered.

Downloads start only when requested. Installation starts after the updater has completed and verified the download and the user clicks **Restart and install**. Closing normally does not silently install an update. Download failures can be retried. A missing or unpublished feed is shown as unavailable, never as “up to date”.

Source runs (`pnpm --filter @vestra/nova start`) expose the version and release link but do not self-update. Portable runs are excluded. Test self-updates using an installed Windows build; older builds without this updater need a one-time installer upgrade first. The release workflow supports Windows x64 because the bundled provider worker currently supports that platform.

## Release procedure

1. Bump **apps/nova/package.json** with one command for the desired change:

   ```powershell
   pnpm release:version patch
   pnpm release:version minor
   pnpm release:version major
   ```

   The workspace and extension SDK versions are separate; this changes only Nova's version and does not create a Git commit or tag.

2. Commit and review the release changes. Create and push the matching stable tag, for example `v0.1.3` when the app package version is `0.1.3`. Mismatched tags and prereleases are rejected. Keep appId `app.vestra.nova`, product name and installer identity stable.
3. **Build Nova release** installs locked dependencies, checks types, runs updater and installer tests (including hidden Electron UI tests), downloads mpv, publishes the self-contained .NET 10 worker, builds Nova and creates the Windows x64 NSIS installer.
4. The pipeline validates installer name, app/feed version, byte size, SHA-512, blockmap and embedded GitHub destination. It uploads all update assets to an Actions artifact and a **draft** release. Reruns may replace draft assets; published releases require a new version.
5. Review the installer. Test worker startup, playback and an upgrade from the previous installed version, including preserved settings/progress/extensions. Publish the complete draft as the latest stable release when ready. Apps see published releases only. Attach the installer and blockmap before publishing the metadata.

Actions can also be started manually to produce artifacts without creating a release. Pushing this code alone does not publish an update. This implementation task does not run or publish the remote workflow.

Required assets:

- `Vestra-Nova-<version>-Setup-x64.exe`
- `Vestra-Nova-<version>-Setup-x64.exe.blockmap`
- `latest.yml`

Electron-builder embeds the feed in resources/app-update.yml. No client GitHub token or user provider credential is shipped. The updater verifies download checksums. Configure repository secrets CSC_LINK and CSC_KEY_PASSWORD for Windows signing when a certificate is available. Without a configured certificate, builds can be unsigned; no certificate identity is invented or signature verification disabled. Keep the publisher identity stable across signed releases.

## Local verification

```powershell
pnpm test:updater
pnpm test:updater:ui
pnpm --filter @vestra/nova typecheck
pnpm --filter @vestra/nova release:build
pnpm test:updater:ipc
pnpm release:validate
```

Backend tests use a fake update engine and verify the real updater's version policy. UI tests use an isolated hidden Electron window/profile. The IPC test uses the real bundled updater against a local metadata server, checks the preload/main-process boundary and never downloads or runs an installer. Run it after building Nova's Electron output. Artifact validation verifies real output without running its installer. An installed-version upgrade still needs two versions and manual or disposable-VM verification. Installer configuration preserves app data; schema changes still need migrations in the corresponding feature.

Implementation reference: [AppUpdater](https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/AppUpdater.ts), [NSIS installation](https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/BaseUpdater.ts).
