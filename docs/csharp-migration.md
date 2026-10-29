# Vestra C# migration

The current work checklist is [roadmap.md](roadmap.md). This document retains
earlier implementation checkpoints; later passes supersede their pending items.

## Objective

Continue Vestra with a C# backend and Seanime feature parity as the target.
Preserve the existing TypeScript UI and player during migration. C# performance
is unmeasured; changing language is not itself evidence of a speedup.

## Evidence and boundary

Inventory derived from the local `seanime/internal` source tree and
`seanime/seanime-denshi` on 2026-10-29. The local Denshi package declares 3.10.2;
this is not a verified installed-artifact version. No packaged runtime was
analysed and no REA runtime evidence is claimed.

Seanime separates its Electron client, Go application services, JavaScript
providers, Goja runtime, and host bindings. Goja is not a source catalogue.
Provider compatibility requires the expected host APIs and execution semantics,
not just a JavaScript interpreter.

The local Seanime root contains GPL-3.0 license text while Vestra declares MIT.
This initial foundation is original code. Before translating upstream
implementations, record applicable component licenses and attribution and decide
how the resulting distribution will be licensed; do not label translated code
MIT by default. The existing repository excludes the upstream reference trees.

## Migration inventory

The host foundation is implemented; provider/runtime and desktop integration are partial. A row is complete only after
its acceptance gate passes; this inventory is not a claim of implemented parity.

| Area                        | Local Seanime reference                                                                                      | Acceptance gate                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host foundation             | `server`, `core`                                                                                             | C# build, health and truthful capability responses (implemented)                                                                                    |
| Desktop lifecycle (partial) | Denshi `src/main`                                                                                            | Private stdio worker readiness/error/shutdown tested; development opt-in added; packaged rollout and crash reload pending                           |
| Provider runtime (partial)  | `goja`, `extension_repo`, `extension/hibike`                                                                 | Jint runs the online-stream JS contract; one upstream source completes offline search/episodes/stream; more bindings and live compatibility pending |
| Extension management        | `extension`, `extension_repo`, `plugin`, `hook`, `hook_resolver`                                             | Install/update/configure extensions; compatibility matrix for each extension category                                                               |
| Catalogue and accounts      | `api`, `platforms`, `user`                                                                                   | Metadata, account credentials and list sync survive restart and offline errors                                                                      |
| Library                     | `library`, `library_explorer`, `local`, `continuity`                                                         | Scan, matching, incremental changes and progress persistence verified on fixtures                                                                   |
| Database and configuration  | `database`, `constants`                                                                                      | Versioned migrations, recovery and explicit existing-data import                                                                                    |
| Online sources              | `onlinestream`, `customsource`                                                                               | Validated streams, headers and subtitles reach the existing player                                                                                  |
| Downloads                   | `torrent_clients`, `torrents`, `debrid`                                                                      | Queue and lifecycle parity, failure recovery and cancellation                                                                                       |
| Streaming services          | `torrentstream`, `directstream`, `mediastream`, `mediacore`                                                  | Seeking, range requests and cleanup verified for each transport                                                                                     |
| Playback and containers     | `player`, `playlist`, `mediaplayers`, `mpvcore`, `nativeplayer`, `videocore`, `matroska`, `mkvparser`, `pgs` | Existing player remains usable; stream tracks, seeking and resume verified                                                                          |
| Manga                       | `manga`                                                                                                      | Search, chapter reading, downloads and progress                                                                                                     |
| Events and integrations     | `events`, `notification`, `notifier`, `discordrpc`, `nakama`, `cron`                                         | Reconnect, cancellation and per-integration behavior verified                                                                                       |
| Supporting services         | `security`, `doh`, `updater`, `report`, `util`, `vendor_habari`, `icon`                                      | Classify and implement required behavior; document replacements and exclusions                                                                      |
| Client parity               | `seanime-web`, `seanime-denshi`, `mobile`                                                                    | Feature-by-feature UI and platform matrix; existing Vestra UI retained initially                                                                    |

Tests, development helpers and generated code are supporting inputs rather than
features. This directory inventory needs deeper endpoint and behavior tracing
before it can establish complete feature coverage.

## First functional slice

1. Extract the online-stream contract and a small representative provider fixture.
2. Inventory its required bindings: HTTP, HTML selection, crypto, URL/Buffer,
   preferences, Promise scheduling and TypeScript transpilation as applicable.
3. Evaluate a C#-accessible JavaScript engine against those requirements. Do not
   rewrite Goja; do not assume interpreter choice establishes compatibility.
4. Implement bounded execution and the required bindings, with explicit errors
   for unsupported APIs. Keep extension code separate from the player renderer.
5. Wire a Nova adapter through private stdio (initial preview implemented); authenticated HTTP endpoints are unnecessary for this worker route.
6. Verify search -> episodes -> stream -> player, including stream headers,
   subtitles, cancellation, timeouts and malformed provider results.

## Performance acceptance

Capture baseline and candidate on the same machine, media, provider fixtures and
cache conditions. Record cold/warm startup, idle/peak memory, library scan time,
provider response p50/p95 and time to first frame. Distinguish network time from
host execution. No speedup is claimed until repeatable measurements support it.

## Current limits

The HTTP host serves health/capability discovery. The separate C# provider worker
supports a JavaScript online-stream subset; Nova has an explicit development
opt-in adapter. No default providers were replaced. TypeScript transpilation,
remaining DOM APIs, crypto and unsupported Buffer/URL/browser APIs, persistent provider state, full media context,
mirror selection, packaged deployment and crash reload remain unresolved.

Runtime and worker tests verify JSON boundaries, Promise rejection, cancellation,
limits, host identity and validation. An external AniDB provider source completed
search -> episodes -> stream resolution against offline HTML/JSON fixtures;
SHA-256 `B565C0B728A72A09979D992A6A1D63F81910260DFE3BB7C9033D9BDBC982A2EA`.
This is source-level controlled execution, not installed-package analysis or live
service verification. There are no REA Evidence IDs for this source-only pass.

Provider playback now has an opaque main-process handle path to native mpv.
Stream headers and subtitle URLs are forwarded and reset on each load. Episode
streams resolve lazily when opened instead of eagerly fetching up to 200 episodes.
C# episode cache handles distinguish identical upstream episode IDs across titles.
The installed mpv passed a local HLS audio/subtitle fixture with header checks on
playlist, segment and subtitle requests, plus option reset checks. Real-provider
HTTPS/CDN playback and visual Electron end-to-end verification remain pending,
along with quality selection and explicit subtitle language/title metadata.
Database and remaining parity rows are pending. No measured speedup is claimed.

## HTML compatibility pass

Added AngleSharp 1.8.6 behind JSON selection handles with no resource loading or
script execution. The supported read-only Doc/LoadDoc subset and binary-string
atob/btoa are documented in apps/server/README.md. Invalid selectors, absent
attributes, callback arguments, traversal, negative/out-of-range indices, parser
side effects, document budgets and base64 behavior have fixture coverage.

29 runtime cases passed with both optional external-provider tests enabled.
The local AnimeSaturn mirror source completed offline search -> episodes -> iframe
selection -> stream resolution; SHA-256
`0199CBE8414F83ACCCB48A7BBBCE7E6DC5C05FB12BEE00CD340EABEA2ADB6FE4`.
No live-site compatibility or browser behavior is inferred from this result.
The transport now accepts Content-Type on a GET with empty content, matching a
request shape used by that provider. This pass does not implement crypto,
TypeScript transpilation, storage or browser automation. Buffer/URL subsets were
added in the subsequent pass below.

## Binary and URL compatibility pass

Added bounded Buffer string/byte conversion, UTF-8/Latin-1/hex/base64/base64url,
URLSearchParams form encoding and mutation, and HTTP(S) URL parsing with live
query parameters. API limits and differences from Node/WHATWG are recorded in
apps/server/README.md. No .NET objects are returned to provider code.

43 runtime cases passed with all three optional external-provider tests enabled.
The DonghuaStream source completed offline search -> episodes -> base64 iframe
decoding -> stream resolution; SHA-256
`5ED11D189ED8F04BF4DAA50B4A9F5135F9D939E80695EBCF6E681B6A4FDF7C3A`.
Form parameter sorting was cross-checked with the installed Node runtime.
Live-provider service behavior, full Node compatibility and performance gains
remain unverified at that checkpoint. See the subsequent pass below.

## TypeScript, crypto, persistence and live-probe pass

Added trusted TypeScript preprocessing in Nova, C# AES-CBC and hash bindings,
and per-provider atomic JSON persistence across worker restarts. 46 runtime
tests pass with the three optional source paths enabled. Additional process
checks cover independent Node crypto vectors, salted decryption, actual TS
provider load/settings, persistent restart and identity isolation.

Live probes found one redirected source, one working search/episode flow with
a failed player extractor, and one source returning no search matches. These
failures remain unresolved; no complete live-source compatibility is claimed.
Detailed scope, API limits and repeatable commands are in
[provider-runtime-status.md](provider-runtime-status.md).

## Nested-player repair

AnimeSaturn's player now contains an iframe pointing to cdn2.megaplay.su; the
nested page exposes a literal primary HLS URL. Added an opt-in source override
after transpilation, with three-page maximum traversal, cycle rejection and no
page-script execution. The example grants that observed host explicitly.
Live checks now pass search (10), episodes (1), stream resolution (1) and HLS
manifest validation (HTTP 200). Fixture checks cover nesting, relative URLs,
Referer preservation and cycles. AniDB/DonghuaStream failures and live visual
playback remain unresolved. No media segments were downloaded by these probes.

## Catalogue and mirror verification

The current DonghuaStream source changed since the earlier probe. A Battle query
yields six titles and three episodes. Server 1's manifest responds HTTP 403;
Server 2 returns HTTP 200 and valid HLS. Added preferredServer configuration,
validation and an explicit Server 2 selection in the example. Live diagnostics
now record the query, source hash, bounded mirror checks and summary counts.
Missing local sources are reported without aborting the remaining checks; the
original AniDB provider is now absent. No live visual playback is claimed.

## Response semantics and recovery audit

Corrected synchronous Seanime response body semantics; added text forms, Headers,
JSON and URL-encoded request serialization. Runtime coverage now totals 53 cases.
Nova can restart/reload after worker failure on the next request while preserving
provider data and never retrying an interrupted call; three process tests pass.
The worker exposes a capabilities command. The Goja engine itself has not been
ported and extension-host parity is incomplete; the explicit remaining matrix
is in [goja-port-status.md](goja-port-status.md).

## Manga contract pass

Added typed manga-provider loading/dispatch, validation and host-stamped identities
for search, chapter lists, chapter pages and settings. Existing online-stream
commands retain their default contract. 59 runtime cases pass, including a real
Manganato source on offline fixtures; four process tests include manga recovery.
Two live sources completed metadata flows: MangaStash (24/21/71) and Manganato
(20/2/68), where counts are search results/chapters/pages. No images were fetched.
Reader UI, image delivery, chapter downloads, reading progress and host-side manga
ranking are pending. Details are in [manga-provider-status.md](manga-provider-status.md).

## Reader integration pass

Added a separate Nova manga registry/IPC, renderer navigation and reader, guarded
binary image delivery through opaque handles, and persisted provider/book-scoped
reading progress using the existing TypeScript storage driver. Images are fetched
only for the current page; non-raster/oversized/failed responses are rejected.
64 runtime tests and three main-service tests pass, alongside process tests and
build/type checks. Both live sources successfully fetched one image each. Desktop
visual QA was attempted but the helper could not activate the returned test window;
the instance was stopped. Interactive visual verification, downloads, advanced
reader layouts and migration of the reading-progress repository to C# remain open.

## C# reading-progress pass

The reading-progress repository now runs in C#. Nova retains only the IPC adapter,
loaded-chapter validation and read-only legacy import path. Versioned JSON writes
use atomic replacement with a preceding flush; corrupt/oversized state fails
visibly. Imports retain the original timestamp and cannot overwrite C# state.
The old Vestra file remains as a recovery copy. This is a Vestra state migration,
not a Seanime database import. One worker owns the directory.

72 .NET cases, five process tests and four reader-service tests pass. The service
tests exercise the real C# process, a full restart and legacy migration. Type-check
and builds pass. Interactive visual verification, downloads, advanced reader
layouts and the broader Seanime database migration remain open.

## Source management pass

Nova now has a Sources screen with native local-script imports, persisted
configuration, enable/disable/remove controls, runtime checks and server selection.
Runtime registration is per source; activation errors no longer tear down every
loaded source. The legacy environment config is a first-run seed. Management
storage remains TypeScript/Node-backed. Six management tests include actual C#
load/unload and disabling after cancellation without replay. Packaged worker
distribution, remote marketplace imports/updates and visual UI checks remain open.
See [source-management.md](source-management.md).

## Windows worker packaging pass

Added self-contained Windows x64 publishing, packaged-executable selection, runtime
asset checks and bundled TypeScript preprocessing with its license. Packaged source
imports are enabled. The published worker and the copy inside an actual unpacked
Electron build pass SDK-hidden tests; its ASAR compiler is extracted and tested
outside node_modules. Three packaging checks include the existing five worker
protocol tests against the executable. Clean-machine installation and visual
application flows remain unverified. See [worker-packaging.md](worker-packaging.md).

## Background reader-completion pass

Added C# recent-reading metadata/listing and Continue Reading entries that restore
known books without a source search. Progress stays compatible with the previous
v1 shape; optional metadata is added on save. Reader controls now support chapter
navigation, language/scanlator filtering, page jumps, RTL/double pages, fit and zoom.
Appearance preferences remain local to the TypeScript renderer profile. A spread
saves progress only after all visible images decode, and image/save failures can
be retried independently. Interactive checking and installer refresh are deferred
at the user's request; [desktop-verification.md](desktop-verification.md) records
the earlier limited packaged observations.

## Local source replacement pass

Added reviewed local JS/TS script replacement through staged chooser tokens.
Source content fingerprints reject stale replacement requests. Existing IDs,
settings, host grants and data namespaces are retained. Enabled candidates must
load and pass settings/server validation before the new registry record is saved;
failures attempt to restore the previous runtime. Disabled replacements do not
execute. Eleven management tests pass, including actual worker replacement and
rollback checks. Remote updates/version history, visual verification and installer
refresh remain pending. See [source-management.md](source-management.md).
