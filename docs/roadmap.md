# Vestra development checklist

Updated: 2026-10-29. This is the working checklist for continuing Vestra with a
C# backend and the existing TypeScript UI/player. Checkmarks mean the stated
implementation and automated verification exist; they do not imply full Seanime
parity or a visually verified release. Unchecked items may already have a
TypeScript implementation in Vestra; their C# migration or validation is pending.

Goja itself has not been translated. Jint replaces the JavaScript engine, with
selected Seanime host APIs implemented in C#. No speed advantage has been measured.

## Implemented and automated checks passing

- [x] C# solution, server foundation, health and capability discovery.
- [x] Private Electron-to-C# worker protocol, deadlines and cancellation.
- [x] Restart a failed worker and reload successful definitions without retrying interrupted calls.
- [x] Jint execution budgets and validated provider results with host-stamped identity.
- [x] Online-stream provider methods: search, episodes, stream resolution and settings.
- [x] Manga provider methods: search, chapters, page metadata and settings.
- [x] Guarded HTTPS transport with explicit hosts, public-address checks, redirect checks and response caps.
- [x] Seanime synchronous response text/JSON semantics, Headers and text form helpers.
- [x] Read-only HTML selection subset, Buffer subset and URL/query helpers.
- [x] Crypto subset: AES-CBC, implemented hashes/encoders and random bytes.
- [x] Trusted TypeScript preprocessing for global Provider scripts.
- [x] Atomic C# provider-script storage and supplied preferences.
- [x] Lazy anime stream resolution with opaque main-process handles.
- [x] Forward stream headers/subtitle URLs to mpv and reset options between loads.
- [x] Preferred stream-server configuration and validation.
- [x] Preview manga reader: source/search/chapter/page selection and keyboard navigation.
- [x] Guarded raster-image delivery through opaque page handles.
- [x] C# reading-progress saves, restart persistence and legacy Vestra progress import.
- [x] Sources screen: local JS/TS import, configuration, enable/disable and removal.
- [x] Persist managed source copies and keep one failing source from blocking the others.
- [x] Runtime checks and visible provider-load errors; disabled sources stay out of worker replay.
- [x] Live metadata/manifest checks for selected anime providers and single-image checks for two manga providers, recorded with source hashes.

Latest recorded verification: 78 .NET cases, five worker-process, five reader-service,
five reader-navigation, eleven source-management, five remote-source and five
subtitle-loader cases, plus the player-quality state and two playback-helper cases.
Nova type checks and builds
pass. Native mpv passed a controlled local HLS/header/subtitle fixture. Live checks
are source-specific observations and can become stale. Visual end-to-end checks
remain unchecked below.

Recent feature work is on stacked branches: `codex/remote-provider-updates`,
then `codex/stream-quality-selection`, then `codex/subtitle-track-metadata`.
The final branch includes the earlier two. Native playback tests remain deferred;
the optional native mpv fixture was skipped in these passes.

## 1. Package the working preview — implementation complete; clean-machine gate open

- [x] Publish the C# worker as a self-contained Windows x64 executable.
- [x] Launch the bundled executable from Nova while preserving the development DLL path.
- [x] Include the worker and required assets in the desktop installer.
- [x] Package TypeScript preprocessing so installed builds can import TS scripts.
- [x] Remove the development-only source restriction once packaged execution passes.
- [x] Show a useful missing-worker/startup error in the application.
- [ ] Verify install, launch, source import, restart and clean shutdown on a machine without the .NET SDK.

Acceptance: an installed copy can load both provider types with no source checkout,
environment-variable setup or separately installed .NET SDK.

The self-contained worker and actual unpacked application's resources pass SDK-hidden
smoke checks, including TS preprocessing from its ASAR asset. See
[worker-packaging.md](worker-packaging.md). This does not close the clean-machine
installation or visual end-to-end gates.

## 2. Verify the actual desktop flows

- [x] Observe packaged Sources, the native chooser and a local MangaStash import loading successfully.
- [ ] Visually verify source configuration, error states and enable/disable flows.
- [ ] Run anime search → episodes → chosen server → actual video playback in Nova.
- [ ] Verify seeking, resume, subtitle selection and headers against representative media.
- [x] Observe a decoded manga image in the packaged reader and its C# page-zero progress on disk.
- [ ] Verify manga page navigation, chapter navigation, layouts, restart and resume interactively.
- [ ] Verify disabling/removing/reconfiguring a source while its UI has cached results.
- [ ] Verify offline errors, timeouts, broken scripts and worker recovery in the app.
- [ ] Fix UI, accessibility and layout issues found during these checks.

Acceptance: these user flows pass in the packaged application, with actual playback
and decoded images rather than only successful metadata/manifest responses.

Interactive checking stopped on the user's Escape request and remains deferred
while they use the desktop. The limited observations are recorded in
[desktop-verification.md](desktop-verification.md). New reader controls added
after that observation still need visual verification and an installer refresh.

## 3. Measure performance and fix demonstrated bottlenecks

- [ ] Capture a Seanime baseline and current Vestra measurements on the same machine.
- [ ] Measure cold/warm startup, idle/peak memory and time to first video frame.
- [ ] Measure provider execution separately from network latency, including p50/p95.
- [ ] Measure library scan and manga page-load times with repeatable fixtures.
- [ ] Profile slow paths and implement justified scheduling, caching or IO improvements.
- [ ] Repeat the measurements and document regressions as well as improvements.

Acceptance: reproducible measurements support every speed or memory claim. Capture
baselines before the broader service migrations so later comparisons remain useful.

## 4. Expand provider compatibility and source lifecycle

- [ ] Build a representative provider compatibility corpus and track exact source versions.
- [ ] Supply complete media context instead of the current minimal anime search context.
- [ ] Fill required HTML, crypto, Buffer/URL and response API gaps using failing fixtures.
- [ ] Implement required request cancellation, cookie semantics and concurrent IO scheduling.
- [ ] Define module/import support and the remaining TypeScript packaging/runtime policy.
- [x] Replace local source scripts while preserving identity/settings, with rollback on failed enabled-source updates.
- [x] Preview and install remote provider manifests with reviewed host grants and pinned script bytes.
- [x] Track remote versions, manually check updates and restore up to three prior scripts.
- [ ] Add unattended update policy/scheduling if required; current updates require review.
- [ ] Add website-health diagnostics separately from the existing runtime check.
- [ ] Complete source preference metadata, editing and lifecycle behavior.
- [ ] Audit and implement remaining extension types, hooks and plugins.
- [ ] Decide which browser/timer/scanner/torrent bindings are needed and implement or explicitly exclude each.

Acceptance: publish a per-provider and per-API support matrix with explicit failures;
one successful provider does not establish full compatibility.

## 5. Migrate the remaining application data and services to C#

- [ ] Inventory the existing Vestra repositories and corresponding Seanime behaviors.
- [ ] Define versioned database/configuration schemas and migration ownership.
- [ ] Migrate the managed-source registry from Node-backed persistence to C#.
- [ ] Migrate catalogue metadata, credentials and account/list synchronization.
- [ ] Migrate library scanning, matching, incremental updates and local-media services.
- [ ] Migrate watchlists, history, video progress, bookmarks and remaining settings.
- [ ] Add explicit import paths for existing Vestra data and supported Seanime data.
- [ ] Verify restart, offline operation, migration rollback/recovery and backup restoration.
- [ ] Define ownership for multiple application instances accessing the same data.

Acceptance: existing data survives migration and rollback tests. C# reading progress
and provider storage are already implemented; they do not constitute a full database port.

## 6. Finish anime playback and download services

- [x] Select provider-advertised stream qualities per episode using opaque handles and refreshed URLs.
- [x] Preserve subtitle language/title/default metadata through both provider hosts and native track-add commands.
- [ ] Verify the updated quality picker and subtitle loading path with actual video playback.
- [ ] Migrate/audit playlists, player lifecycle, containers and required track behavior.
- [ ] Implement persistent download queues, progress, cancellation and recovery.
- [ ] Implement and verify supported torrent-client and debrid integrations.
- [ ] Implement torrent/direct streaming, range requests, seeking and cleanup.
- [ ] Audit custom-source contracts and remaining media services against upstream behavior.

Acceptance: each supported transport has playback, seek, cancellation and cleanup
coverage, including failed and interrupted downloads.

## 7. Finish the manga experience

- [x] Add continuous/Webtoon layouts, per-series preferences, immersive controls, fullscreen and a progress slider; see [reader checklist](manga-reader-checklist.md).
- [x] Add a focused reading canvas, searchable chapter drawer and compact persistent page controls (desktop visual verification pending).
- [x] Add next/previous chapter navigation and C#-backed Continue Reading entry points.
- [x] Add left/right reading direction, double-page mode, fit/zoom and remembered reader preferences.
- [x] Add language/scanlator filtering, page jumps and separate image-decode/save retry controls.
- [x] Add provider cover art, a compact library grid and persisted Continue Reading artwork.
- [ ] Add host-side search ranking where required.
- [ ] Implement persistent chapter downloads and offline reading.
- [ ] Verify chapter ordering, language/scanlator selection and changing page counts.
- [ ] Verify downloaded-image integrity, retry behavior and progress consistency.

Acceptance: reading, resuming and offline chapters work across restarts with the
supported layouts and provider variations.

## 8. Complete the feature audit and release gates

- [ ] Trace remaining Seanime endpoints/features and turn the broad inventory into concrete parity cases.
- [ ] Implement required events, notifications, scheduled work and integrations.
- [ ] Audit updater behavior, diagnostics, configuration and remaining support services.
- [ ] Document replacements and deliberately excluded features in the parity matrix.
- [ ] Resolve component licensing, notices and attribution for distributed code/dependencies.
- [ ] Run packaged release regression checks and document supported platforms.
- [ ] Mark full parity only when the agreed feature matrix passes.

The later phases remain a broad inventory. Add concrete acceptance cases as each
subsystem is traced; do not use these headings as evidence that every upstream
feature has already been identified.

## Supporting records

- [C# migration history and upstream inventory](csharp-migration.md)
- [Engine and host-API compatibility gaps](goja-port-status.md)
- [Source management behavior and limits](source-management.md)
- [Manga implementation and verification](manga-provider-status.md)
- [Provider runtime observations](provider-runtime-status.md)
