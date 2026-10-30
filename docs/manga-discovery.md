# Manga discovery

The library shows a compact Continue Reading shelf followed by a public AniList
catalogue. It supports Popular, Trending, Top Rated and Newest ordering, Japanese
manga / Korean manhwa / Chinese manhua origin filters, genres, ongoing/completed
status and pagination (24 titles per page).

Catalogue results describe metadata popularity, not availability in the selected
reading source. Selecting a catalogue card opens information and automatically
resolves the selected source's own manga ID, then loads its chapter index. The
library's source URL parameter is the only provider selection. No Find in source
step is needed. Unavailable or ambiguous matches have explicit empty/error states.
Direct source search remains available; catalogue filters do not pretend to filter
provider search results.

The fixed AniList query runs in main and uses variables, non-adult MANGA/ONE_SHOT
results, the largest available cover images and an HTTP deadline. The v2 metadata
cache drops old medium-only results so existing installations fetch sharper art. Unset optional filters are
omitted: sending explicit nulls can return an empty catalogue. The genre menu is
supplied by GenreCollection. Origin uses countryOfOrigin rather than guessing from
title language. See [AniList query reference](https://docs.anilist.co/reference/query).

Identical requests share one call. Popular/rating/newest metadata is cached for an
hour; trending for ten minutes. Up to 32 filtered pages persist across restarts.
When upstream fails, a saved page for the _same_ filters can be returned with an
explicit stale notice, for up to seven days. Filter changes debounce for 180 ms,
in-flight requests are bounded, and HTTP 429 applies a shared cooldown.

Catalogue covers receive main-owned handles and share the guarded C# image pool
and persistent cover-byte cache. Only the first eight are warmed in advance;
other cards load near the viewport. Image retries invalidate saved bytes and
replace the opaque handle, updating cached catalogue cards. Catalogue artwork
never registers a fake manga reading provider or creates reading history.

## Verification

- `node apps/nova/scripts/test-manga-discovery.mjs` checks variables, cache/restart,
  deduplication, offline/filter isolation, input bounds, cooldown and image ownership.
- Add `--live` to verify AniList. The implementation check returned 24 popular
  titles, all with covers, 19 genres, and 24 completed Korean Action titles whose
  country, genre and status matched the selected filters.
- The offscreen reader/library fixture checks filters, page reset and
  automatic catalogue-to-provider-ID matching, alongside the existing reader regression cases.
- `node apps/nova/scripts/test-manga-cover-cache.mjs` verifies that a new main service
  reuses cover bytes from disk without another download.

Cached covers avoid repeat downloads. Cold-load speed still depends on the source
or AniList CDN; no universal network speedup or full catalogue/provider match is claimed.
