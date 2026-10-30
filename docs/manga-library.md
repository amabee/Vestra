# Manga library

The Manga page uses a compact heading, one source/search toolbar and a responsive
cover grid. Continue Reading is the default shelf, with page position and the last
read date. Searching replaces that shelf with results; clearing search restores it.
Cards open the existing reader, and its Library button returns to the current
search. Sources remain available through one icon link rather than another panel.

Cover bytes now have a main-process memory cache and a persistent disk cache.
The cache is scoped to provider, URL and headers, expires after seven days, and is
bounded to 32 MiB in memory / 128 MiB on disk (64 / 512 entries respectively).
First-shelf artwork starts warming before the renderer requests it; duplicate
requests share one download. Retry Cover invalidates saved bytes. Cache failures
fall back to the normal guarded image fetch. Chapter pages are not stored here.
`node apps/nova/scripts/test-manga-cover-cache.mjs` verifies restart reuse without
another source download, expiry, corrupt/oversized recovery, bounds and refresh.

Cover artwork comes from each provider's `image` and optional `imageHeaders` search
fields. Main registers separate cover handles, so loading library artwork cannot
evict a full reader's page handles. The renderer receives opaque handles and raster
image data through the same guarded C# transport as chapter pages. Remote URLs and
headers remain in main/the worker. Covers load near the viewport, through the
bounded image loader; source removal invalidates their handles and pending results.

Missing or failed artwork shows a quiet title fallback, with loading shown separately.
There is no guessed artwork or external metadata matching. Older saved entries
without artwork automatically search their source by the stored title and accept
only the exact provider book ID. Successful enrichment is persisted without
changing the saved chapter/page or reading timestamp and creates no history entry.
Only two metadata lookups occupy the provider lane at a time, and queued lookups
are cancelled when their cards unmount. A failed image is labelled as a
load failure, with a separate Retry Cover action that does not open the reader.

The optional cover URL and headers are persisted with C# reading progress. Existing
v1 files remain valid. Saves without new artwork preserve stored covers; oversized
artwork metadata is omitted rather than blocking the reading-position save. Recent
reading recreates fresh handles after restart, retaining headers needed by the image
host. The file size limit remains 32 KiB.

The host displays up to 400 source results, leaving room in its 2048-title grant
cache for recent entries and bookmarks. The UI initially renders 48 cards with Show More for
larger results. This keeps artwork requests and the initial grid bounded.

Validation includes C# cover persistence/legacy/bounds checks, service checks for
opaque handles and restored cover headers, and an offscreen Electron library flow
using actual PNG decoding. That flow covers missing/broken images, search, opening
the reader and returning to the shelf under React StrictMode. Live provider art
availability beyond the specific live check below and a packaged installation
still need manual verification.

## Cover repair verification

The live MangaStash check searched Solo using the installed provider source. All
24 returned records contained an image and received main-owned cover handles.
Three search covers plus a backfilled saved-title cover downloaded through the
C# image pool and decoded in offscreen Chromium (200×299, 300×428 and 300×419 JPEGs).
The backfill check used an isolated store and preserved the saved reading position
and timestamp. User reading files were inspected read-only, never rewritten by
the diagnostic. The normal app backfills them when the shelf is opened.

## Information and bookmarks

Library, recent and discovery cards open information before reading. Source
information shows its chapter index with chapter search and an explicit
Start/Continue reading action. AniList supplies synopsis, genres and available
publication facts; source titles only receive metadata after a unique exact
English/Romaji/native title match. Missing catalogue metadata never blocks source
chapters. Catalogue information resolves the selected reading source automatically.
Details, selected chapter, reading and saved-shelf state have URL parameters.

The bookmark icon on each card and information page saves a series without
creating reading progress. The Bookmarks shelf includes source and catalogue
entries. The C# worker atomically persists up to 500 entries (1 MiB metadata) in
`csharp-provider-store/manga-bookmarks.json`, preserving covers and original save
timestamps. Source removal leaves bookmarks available for later removal or source
reinstallation. Metadata stores private image requests; IPC returns opaque cover
handles. Corrupt bookmark files surface an error and are preserved.

`node apps/nova/scripts/test-manga-information.mjs --live` checks exact matching,
metadata cache restarts, high-resolution artwork, real C# bookmark restarts,
source isolation and independent progress. The offscreen UI fixture checks both
information flows, card/detail bookmarks and saved-shelf removal.

## Provider identity and automatic chapters

The library dropdown writes `source` in the URL, reused unchanged by details and
the reader. There is no separate details provider state. `bookSource` records only
the origin of a provider-specific ID (for a bookmark from another source); it does
not change the selected reading source. Catalogue IDs remain AniList identities.

`MangaTitleResolver` bridges catalogue/origin IDs to the selected provider. It uses
a unique exact normalized English, Romaji or native title match and rejects
ambiguous editions. It persists at most 256 mappings for seven days under
`manga-provider-mappings-v1`, keyed by selected provider plus original identity.
After restart it restores grants using the exact persisted provider ID, saved
bookmarks/recent entries or a provider search that confirms the same ID. Removed
IDs are rematched. In-flight requests deduplicate; stale results after source
replacement are rejected. No mapping operation creates reading progress.

Details requests provider artwork first, with catalogue fallback and explicit
retry/placeholder states. Images use `object-fit: contain` inside a stable cover
frame. Chapter search, oldest/newest ordering, batches of 50, loading skeletons
and recoverable errors keep long chapter lists usable.

The live automatic path resolved AniList Solo Leveling (105398) through MangaStash,
returned 212 chapters and fetched its provider cover. Source availability can
change. Tests also cover provider isolation, mapping restarts, aliases, ambiguity,
stale IDs, removed-source bookmarks, direct links, source switching and retry.
