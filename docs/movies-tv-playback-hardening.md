# Movies/TV playback hardening

## Changes

- Automatic Movies/TV playback refreshes source credentials once before excluding
  a failed provider. MovieBox and KissKH commonly expose one named server, so
  excluding that server immediately could discard a fresh URL for the same episode.
- Recovery prefers the current rendition, keeps refreshed headers and subtitles,
  and updates the short-lived playback cache. Previously advertised URLs are not
  mistaken for refreshed credentials. Quality reductions are marked accordingly.
- Unchanged URLs cannot cause an endless refresh loop. Disabling or replacing an
  extension during extraction aborts recovery. Manual quality selection and anime
  mirror recovery retain their existing behavior.
- Fractional specials, such as KissKH episode 13.5, preserve their number through
  the streaming queue and playback schema, alongside the stable progress identity.
  Existing integer-only anime skip-time lookup guards remain in place.

These fixes are in the application; existing extensions do not need reinstalling.

## Live checks

Checked public guest access on 2026-11-02 using the native QuickJS runtime and
guarded HTTP transport, without installing sources into a user profile.

| Source   | Title                                       | Entries | Delivery                | Subtitle tracks |
| -------- | ------------------------------------------- | ------: | ----------------------- | --------------: |
| MovieBox | Sherlock                                    |      12 | MP4, unlocked 360p/480p |               9 |
| MovieBox | Night of the Living Dead                    |       1 | MP4, unlocked 480p      |              13 |
| KissKH   | Goblin — Guardian: The Lonely and Great God |      17 | MP4, auto               |               6 |
| KissKH   | Train to Busan                              |       1 | HLS, auto               |               6 |

All four returned usable bounded media samples. KissKH subtitle text was also
fetched and verified. MovieBox subtitle listings were verified. Guest access does
not establish availability of higher locked renditions.

## Validation and limits

Regression coverage includes refreshed URLs on the same server, unchanged URLs,
quality fallback classification, extension disablement during recovery, fractional
episode schema validation, season ordering, provider matching and progress identity.
Both source payload suites and the existing anime buffering/mirror tests pass.

Live checks cover extraction and small media samples, not full-length playback or
every title/region. The optional installed-mpv integration test was skipped by its
default configuration; native player recovery was tested through existing fixtures.

Commands: `pnpm test:screen`, `pnpm test:screen:ui`, `pnpm test:anime:buffering`,
`pnpm test:playback`, `pnpm test:moviebox:live`, and `pnpm test:kisskh:live`.
