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
another source. Direct detail links containing `source` use it; links without one
retain the existing all-adapter resolution behavior.

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
against the selected source. Persisted manual edition selection and per-episode
streaming resume are separate remaining work.

## Verification

- `pnpm test:anime`: nine backend cases including reference enrichment, selected
  source isolation, owned-file preservation, lazy stream headers, ambiguous
  editions, and source changes during every asynchronous stage.
- `pnpm test:anime:ui`: hidden/offscreen Electron checks of source selection,
  catalogue navigation, player queue handoff, Back/URL synchronization, direct
  links and loading-error retry. No desktop window is shown.
- Playback helper tests preserve quality selection, signed URL refresh, headers
  and subtitles. Native mpv verification is optional and was skipped in this pass.
- Nova type checks and production build pass.

Live provider results are recorded in [live-provider-report.json](live-provider-report.json).
Successful HLS manifest retrieval does not establish decoded video playback,
seeking, subtitle behavior or the availability of other catalogue titles. Those
remain playback verification work.
