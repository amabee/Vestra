# Anime source selection repair

The Anime page was a metadata catalogue. Playback adapters silently required an
exact normalized match between an AniList name and a provider result, so translated
names, romanizations and season suffixes could leave every catalogue title without
episodes. An installed/Loaded provider alone did not establish a usable catalogue
match. This was a gap in the earlier instructions to search any catalogue title.

Anime now has **Watch from your sources** above the catalogue. Select a source,
search it, choose its returned title and open an episode. Quality selection is
available on each episode. The Sources screen's **Browse anime** link selects the
corresponding streaming source. Catalogue no-match states also link here rather
than implying installation alone guarantees playback. Providers only expose titles
they actually carry; DonghuaStream is not a general catalogue of Japanese anime.

Main retains searched title records behind opaque handles, validates current source
ownership and registers lazy playback closures. Replaced/disabled sources invalidate
both the result and deferred stream resolution. Episodes/renditions only resolve
when selected; provider URLs/headers stay in main. Up to 2000 episodes are available
through this flow, with an episode filter. Rendition handles have a separate bounded
pool so choosing a quality cannot evict an episode from a full queue.

The catalogue adapter also tries the supplied original title, keeps Unicode letters
in normalized names, and continues to require exact matches rather than guessing a
different title/season. Manual source selection is the explicit way to resolve an
ambiguous match. Full catalogue-to-source mapping persistence remains future work.

Three background integration cases pass using the actual stream-source factory:
different catalogue/provider naming, lazy episode playback with headers, source
replacement/disable invalidation, and full-queue quality-handle retention. Type
checks and builds pass. This does not verify any particular live site's availability
or actual video rendering; those still require a playback check.
