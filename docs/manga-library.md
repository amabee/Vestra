# Manga library

The Manga page uses a compact heading, one source/search toolbar and a responsive
cover grid. Continue Reading is the default shelf, with page position and the last
read date. Searching replaces that shelf with results; clearing search restores it.
Cards open the existing reader, and its Library button returns to the current
search. Sources remain available through one icon link rather than another panel.

Cover artwork comes from each provider's `image` and optional `imageHeaders` search
fields. Main registers separate cover handles, so loading library artwork cannot
evict a full reader's page handles. The renderer receives opaque handles and raster
image data through the same guarded C# transport as chapter pages. Remote URLs and
headers remain in main/the worker. Covers load near the viewport, through the
bounded image loader; source removal invalidates their handles and pending results.

Missing or failed artwork shows a quiet title fallback, with loading shown separately.
There is no guessed artwork or external metadata matching. Older saved reading
entries without cover metadata continue to work; searching and reading that title
again supplies metadata for future saves.

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
availability and a packaged installation still need manual verification.
