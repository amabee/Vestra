# Anime source selection and catalogue playback

Updated: 2026-10-30.

## Catalogue playback repair

Playback IPC accepts a media reference, which contains no title. Previously it
cast that reference to a full media item and passed it to stream adapters. The
adapters read `title` and `originalTitle`, so the missing title could throw before
any provider search. The orchestration layer swallowed that failure and returned
an empty queue. This was separate from genuine differences between catalogue and
provider naming.

`resolveCataloguePlayback` now resolves trusted catalogue details in main before
asking adapters to match a title. It keeps catalogue IDs separate from provider
IDs: matched provider IDs are used for episode retrieval, while the player retains
the catalogue identity. Exact normalized English/original title matches are
accepted; multiple distinct matching editions require explicit source search.
Fuzzy matches are not selected automatically.

Anime's source dropdown uses the `source` URL parameter as its only selection
state. Its initial default is written to the URL. Catalogue rows and their Play
actions carry that selection into details and playback IPC; query keys include
it. Back and URL navigation update the same selection. Only that community source
searches the catalogue title; owned files and official links remain eligible.
A removed source is reported as unavailable instead of silently switching to
another source. Direct detail links containing `source` use it; links without one choose the first compatible installed extension in the redesigned
view. The local-files view retains all-adapter resolution.

Selected provider errors are surfaced with **Retry episodes** when no working
in-app source remains. Offline metadata can still fall back to owned-file
adapters when no explicit streaming source was requested.

## Direct source browsing and source lifecycle

**Watch from your sources** also supports direct source search and title/episode
selection. This remains useful for ambiguous editions or names without an exact
catalogue match. Sources may only carry a subset of the anime catalogue.

Main retains direct-search title records behind opaque handles. Both direct and
catalogue paths validate current source registration before and after searches,
episode retrieval, and lazy stream resolution. Replacing or disabling a source
invalidates its old playback closures. Both paths support up to 2000 episodes;
provider video URLs, headers and subtitle URLs remain in main. Quality handles
use a separate bounded pool from episode handles.

Catalogue mappings are not persisted yet. Reopening details revalidates the match
against the selected source. Persisted manual edition selection remains future work; per-episode streaming
progress was subsequently added below.

## Verification

- `pnpm test:anime`: 10 backend cases and three mirror-resolution cases including reference enrichment, selected
  source isolation, owned-file preservation, lazy stream headers, ambiguous
  editions, and source changes during every asynchronous stage.
- `pnpm test:anime:ui`: hidden/offscreen Electron checks of source selection,
  catalogue navigation, player queue handoff, Back/URL synchronization, direct
  links and loading-error retry. No desktop window is shown.
- Playback helper tests preserve quality selection, signed URL refresh, headers
  and subtitles. The controlled native fixture is optional; a separate live native video decode
  was verified as described below.
- Nova type checks and production build pass.

Live provider results are recorded in [live-provider-report.json](live-provider-report.json).
Successful HLS manifest retrieval does not establish decoded video playback,
seeking, subtitle behavior or the availability of other catalogue titles. Those
remain playback verification work.


## Integrated extension details (2026-10-30)

Anime Details now owns a URL-backed streaming-extension selector. Its options come
from the enabled runtime registry, not a hardcoded provider list. Direct links with
no selection choose the first compatible loaded extension. Removed/disabled selected
extensions get a distinct recovery state without silently changing the user's choice.

`anime:resolve` validates the catalogue reference, retrieves trusted metadata, reuses
the catalogue adapter's exact title matcher, and asks the selected extension for its
own title/cover and episodes. Catalogue identity and provider title identity remain
separate. The existing provider contract has no synopsis/year/details method, so
those facts remain sourced from catalogue metadata rather than fabricated.

The Hallmark details layout introduces prominent contained artwork, publication facts,
a collapsible synopsis, extension selection, episode search/filter/order, bounded
50-row presentation, quality choices, bookmarks, watched controls and current playback
status. Local files and other adapters retain the original detail view through the
explicit local-playback link. Catalogue Play now uses the same details resolution
rather than doing a second provider search first.

Streaming queues carry stable hashed `progressId` values based on provider, title,
episode number and episode page URL. They do not expose provider video URLs. The
player uses them for reading/saving per-episode progress and retries the same episode
with a fresh playback session. Existing local file IDs and saved local progress are
unchanged. Legacy series-level streaming progress cannot reliably be assigned to a
particular episode, so it is not presented as a completed episode.

## Playback failure and mirrors

The reported error was thrown by DonghuaStream's provider script when it encountered
a Streamplay embed for which that script has no scraper. mpv had not received a
video URL. C# provider resolution now tries its preferred advertised server first,
then other advertised servers, under the existing cancellation and host grants.
It normalizes HLS/MP4 sources, validates result/subtitle metadata, and checks HLS
responses for a successful status and `#EXTM3U` before choosing a mirror. HTTP 403,
HTML instead of a playlist, unsupported formats and extraction errors trigger the
next mirror. It does not pass an embed webpage to mpv or silently enlarge permissions.

The installed script still lacks its own Streamplay scraper; the adapter now supplies
the host-side protocol extractor described below. Episodes for which the upstream
configuration is empty or all advertised mirrors are unavailable return the individual server
failures and an extension/update recovery action. No code can guarantee an upstream
site will publish a playable alternative for every episode.

Verification this pass: 10 anime-service cases, three mirror-resolution cases,
eight offscreen UI groups, 29 install/storage pipeline tests, 11 source-lifecycle
cases, playback quality/header helpers, 18 manga-reader UI groups, typecheck and
production build. One stale install test still assumed streaming types were excluded;
it now checks the current supported-type manifest review path.

A live check used the actual installed DonghuaStream script and its saved host grants
and preferred server, found three episodes for “Renegade Immortal Movie 2: Battle of
Immortal Slayer”, verified Server 2's HLS response, and made native mpv output a decoded
video frame with `--vo=null --ao=null`. No desktop window was shown. This is a real
stream/decode check for one episode, not an interactive seek/subtitle audit or proof
that every mirror/title works. Run `pnpm test:anime:live` to repeat against the installed
anime extension; it intentionally depends on local installation and network state.


Streamplay extraction and current upstream availability are now documented in
[streamplay-extractor.md](streamplay-extractor.md). Manifest-only Available-list
installation is covered in [extension-installation.md](extension-installation.md).
