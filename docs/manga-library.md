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

The host displays up to 400 source results, leaving room in its 500-title grant
cache for recent entries. The UI initially renders 48 cards with Show More for
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
