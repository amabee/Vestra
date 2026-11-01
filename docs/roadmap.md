# Vestra development checklist

Updated: 2026-11-01. Vestra is an independent product with a C# backend and
TypeScript UI/player. Its own extension SDK and user experience set the direction.
Existing third-party providers remain available through optional compatibility
imports. Porting Goja and matching another application's complete feature set are
not goals. Jint is the current C# JavaScript engine.

Checkmarks record implementations and automated checks, not a fully verified
release. Earlier migration and engine-port documents are historical evidence;
they do not define the current roadmap.

## Implemented and automated checks passing

- [x] C# solution, server foundation, health and capability discovery.
- [x] Private Electron-to-C# worker protocol, deadlines and cancellation.
- [x] Restart a failed worker and reload successful definitions without retrying interrupted calls.
- [x] Jint execution budgets and validated provider results with host-stamped identity.
- [x] Online-stream provider methods: search, episodes, stream resolution and settings.
- [x] Manga provider methods: search, chapters, page metadata and settings.
- [x] Guarded HTTPS transport with explicit hosts, public-address checks, redirect checks and response caps.
- [x] Synchronous provider response text/JSON semantics, Headers and text form helpers.
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

Recent performance work adds immediate first-mirror startup, bounded anime
provider isolation and cancellable episode metadata caching; see
[provider performance](anime-provider-performance.md). Builds and hidden native
checks pass; sustained live HD playback and packaged release gates remain open.

## Independent extension platform

- [x] Make Vestra SDK extensions the default Extensions view.
- [x] Keep existing provider scripts in an explicit, optional Compatibility tab.
- [x] Preserve existing provider IDs, host grants, settings and reading progress.
- [x] Publish native SDK contracts and authoring examples for anime streaming and manga sources (SDK 1.1).
- [x] Connect native manga extensions to matching, details, covers, reader and host progress; verify with the real isolate and controlled image transport.
- [ ] Offer native replacements for commonly used imported sources.
- [ ] Define extension update, testing and publishing requirements around Vestra's own contract.

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

- [ ] Capture a Vestra baseline and compare changes on the same machine.
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

- [ ] Inventory Vestra services and define their product requirements.
- [ ] Define versioned database/configuration schemas and migration ownership.
- [ ] Migrate the managed-source registry from Node-backed persistence to C#.
- [ ] Migrate catalogue metadata, credentials and account/list synchronization.
- [ ] Migrate library scanning, matching, incremental updates and local-media services.
- [ ] Migrate watchlists, history, video progress, bookmarks and remaining settings.
- [ ] Add versioned import paths for existing Vestra data.
- [ ] Verify restart, offline operation, migration rollback/recovery and backup restoration.
- [ ] Define ownership for multiple application instances accessing the same data.

Acceptance: existing data survives migration and rollback tests. C# reading progress
and provider storage are already implemented; they do not constitute a full database port.

## 6. Finish anime playback and download services

- [x] Resolve catalogue metadata before provider matching and propagate Anime's selected source through details and Play; see [anime source repair](anime-source-browser.md).
- [x] Reject stale catalogue episode handles after source changes and expose selected-source failures with retry.
- [x] Add integrated extension selection, automatic advertised-mirror fallback with HLS validation, and stable per-episode streaming progress.
- [x] Consolidate provider management into Extensions and redesign Anime Details with Hallmark.
- [ ] Persist explicit catalogue-to-provider edition mappings.
- [ ] Interactively verify streaming resume, seeking and subtitles; one installed-provider episode now passes hidden native video decoding.

- [x] Select provider-advertised stream qualities per episode using opaque handles and refreshed URLs.
- [x] Preserve subtitle language/title/default metadata through both provider hosts and native track-add commands.
- [ ] Verify the updated quality picker and subtitle loading path with actual video playback.
- [ ] Migrate/audit playlists, player lifecycle, containers and required track behavior.
- [ ] Implement persistent download queues, progress, cancellation and recovery.
- [ ] Implement and verify supported torrent-client and debrid integrations.
- [ ] Implement torrent/direct streaming, range requests, seeking and cleanup.
- [ ] Audit custom-source contracts and media services against Vestra requirements.

Acceptance: each supported transport has playback, seek, cancellation and cleanup
coverage, including failed and interrupted downloads.

## 7. Finish the manga experience

- [x] Add continuous/Webtoon layouts, per-series preferences, immersive controls, fullscreen and a progress slider; see [reader checklist](manga-reader-checklist.md).
- [x] Add a focused reading canvas, searchable chapter drawer and compact persistent page controls (desktop visual verification pending).
- [x] Add next/previous chapter navigation and C#-backed Continue Reading entry points.
- [x] Add left/right reading direction, double-page mode, fit/zoom and remembered reader preferences.
- [x] Add language/scanlator filtering, page jumps and separate image-decode/save retry controls.
- [x] Add provider cover art, a compact library grid and persisted Continue Reading artwork.
- [x] Add cached AniList manga discovery with popularity, origin, genre and publication filters and an explicit source-search handoff.
- [ ] Add host-side search ranking where required.
- [ ] Implement persistent chapter downloads and offline reading.
- [ ] Verify chapter ordering, language/scanlator selection and changing page counts.
- [ ] Verify downloaded-image integrity, retry behavior and progress consistency.

Acceptance: reading, resuming and offline chapters work across restarts with the
supported layouts and provider variations.

## 8. Complete the feature audit and release gates

- [ ] Define the remaining Vestra features and their concrete acceptance cases.
- [ ] Implement required events, notifications, scheduled work and integrations.
- [ ] Audit updater behavior, diagnostics, configuration and remaining support services.
- [ ] Document supported features and deliberately excluded integrations.
- [ ] Resolve component licensing, notices and attribution for distributed code/dependencies.
- [ ] Run packaged release regression checks and document supported platforms.
- [ ] Mark release readiness only when the agreed Vestra feature matrix passes.

The later phases remain a broad inventory. Add concrete acceptance cases as each
subsystem is traced; do not use these headings as evidence that every upstream
feature has already been identified.

## Supporting records

- [C# migration history and upstream inventory](csharp-migration.md)
- [Vestra extension direction](extension-direction.md)
- [Historical engine and host-API compatibility observations](goja-port-status.md)
- [Source management behavior and limits](source-management.md)
- [Manga implementation and verification](manga-provider-status.md)
- [Provider runtime observations](provider-runtime-status.md)
