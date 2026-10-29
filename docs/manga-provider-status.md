# C# manga provider contract

The worker supports type `manga-provider` alongside the existing default
`onlinestream-provider`. Nova now includes a development-preview manga reader.
Goja itself has not been translated and full Seanime parity remains incomplete.

The manga method set is search(options), findChapters(mangaId),
findChapterPages(chapterId), and getSettings(). Type-specific method discovery and
dispatch reject missing methods, unknown extension types and cross-contract calls.
Existing online-stream load commands remain compatible when type is omitted.

```json
{"id":"1","kind":"load","provider":{"id":"my-manga","type":"manga-provider","source":"class Provider { /* global methods */ }","hosts":["manga.example"]}}
{"id":"2","kind":"call","providerId":"my-manga","method":"search","args":[{"query":"Solo","year":0}]}
{"id":"3","kind":"call","providerId":"my-manga","method":"findChapters","args":["manga-id"]}
{"id":"4","kind":"call","providerId":"my-manga","method":"findChapterPages","args":["chapter-id"]}
```

Search results need id/title; URL is not required by this contract. Optional cover
URLs, cover headers, synonyms and search ratings are validated when present.
Chapters preserve chapter labels (including fractional labels), scanlators,
languages and indices. Page URLs require HTTPS, indices must be nonnegative and
headers are bounded. The worker stamps provider identity on every returned row.
It preserves returned order rather than rewriting indices or sorting records.

Limits: 2000 search results, 10000 chapters, 2000 pages per call, plus the existing
2 MiB total result and execution budgets. The same guarded transport, source
limits, store, cancellation and recovery apply to both provider types.

## Verification

The earlier contract pass had 59 runtime cases with the optional manga artifact test enabled. That test
runs the existing Manganato source through fixture HTML/JSON without downloading
images. Four process tests pass, including manga dispatch, cross-contract
rejection and correct type restoration after a cancelled worker is restarted.

```powershell
$env:VESTRA_TEST_MANGA_PROVIDER = (Resolve-Path Seanime-Providers/src/manga/manganato/provider.js).Path
pnpm test:server
pnpm test:server:bridge
pnpm check:manga:live
```

The live check records source SHA256 and metadata counts in
[live-manga-report.json](live-manga-report.json). In this pass, query Solo returned:

| Provider   | Search results | Chapters in first result | Pages in first chapter |
| ---------- | -------------- | ------------------------ | ---------------------- |
| MangaStash | 24             | 21                       | 71                     |
| Manganato  | 20             | 2                        | 68                     |

Those initial checks resolved metadata only. The later image-delivery checks below
also fetched a single image per source. Providers can change independently.

## Remaining scope

Nova accepts manga-provider entries into a separate registry, never the anime
playback registry. The Manga navigation item supports source selection, title
search, chapters and page-by-page reading with buttons and Left/Right keys.
Chapter downloads and host-side search ranking remain pending. Double-page/RTL
controls are now implemented, with interactive verification deferred. Full Seanime
manga parity is not claimed.

## Reader and image-delivery pass

Main retains page URLs and headers; the renderer receives only opaque handles.
The private C# image command uses pinned-public-address HTTPS, an exact image-host
redirect scope, a 10-second deadline and a 2 MiB cap. JPEG/PNG/WebP/GIF/AVIF MIME
types are accepted; SVG/HTML, non-success HTTP responses and empty/oversized data
fail visibly. MIME is checked; the native decoder validates image contents.

Only the selected page or double-page spread is fetched, with Retry on failure. Unobserved image-query
data is discarded. The reader sorts metadata by index. Progress saves after
successful image decode through the C# reading-progress repository described below.
Writes are serialized and validated against a loaded chapter/page count, scoped
to provider/book. The C# provider-script store is separate and unchanged.

The example provider configuration includes MangaStash. Start the preview using
apps/server/README.md, then choose Manga. The image command is private stdin IPC;
provider JavaScript does not receive an unrestricted image-fetch API.

Validation: 64 runtime cases, four process tests and three main-service tests pass.
Service tests cover opaque handles, header preservation, invalid handles/MIME and
disk-backed progress across service/driver restart. Live checks fetched one image
per source: MangaStash JPEG (373818 bytes) and Manganato WebP (338412 bytes).
No bulk chapter was downloaded. Type-check and Electron/renderer builds pass.

Visual desktop QA was attempted using computer-use. The helper could not activate
the returned Vestra window after a fresh-window retry; the test instance was
stopped. Interactive UI and visual layout checks remain unverified.

## C# reading-progress persistence

Nova now sends progress reads and saves to private worker commands `progress:get`,
`progress:save` and `progress:import`. Provider JavaScript has no access to them.
The C# store writes versioned JSON under
`VESTRA_PROVIDER_DATA_DIR/reading-progress/`, using hashed provider/book keys,
atomic replacement and a disk flush before replacement. The server stamps save
times; both main and C# validate page bounds (at most 2000 pages). Missing data
directories, corrupt documents and documents over 32 KiB fail visibly. A save
does not silently replace corrupt data. Ownership is one worker; concurrent
independent application instances sharing this directory are not supported.

On the first read without C# state, Nova reads the old TypeScript progress file
and imports it, preserving its timestamp. Import cannot overwrite an existing
C# position. The legacy file remains as a recovery copy; subsequent saves write
only to C#. This migrates Vestra reading progress, not Seanime's full database.

Current validation: 72 .NET cases, five worker-process tests and four reader-service
tests pass. Reader-service checks use the actual C# worker and cover full worker
restart, provider isolation and legacy import with preservation of the old file.
Type checks and Electron/renderer builds pass. Run `pnpm test:manga:reader` to
build the worker and exercise this path. Visual UI verification remains open.

## Continue Reading and reader controls

The private `progress:recent` command lists up to 12 positions for an enabled
provider, ordered by save time. C# progress documents now carry optional provider,
book and title metadata while retaining version 1's progress shape for older
readers. Existing anonymous v1 records still resume when a title is opened and
gain metadata on the next save. The recent scan reads at most 1024 JSON files;
partial scans and unreadable records are reported to the UI. Direct reads/saves
continue to surface corruption and identity mismatches instead of replacing it.

Nova rehydrates known book IDs from this validated list, so Continue Reading can
open saved titles after restart without repeating a provider search. Main still
requires chapter metadata before serving pages. No cover URLs or page URLs are
added to these list responses.

Reader controls now include previous/next chapter, an end-of-chapter action,
language/scanlator filters, page jumps, LTR/RTL, single/double pages, optional first
page alone, fit height/width and 50–200% zoom. Chapter order follows provider
indices; fractional chapter labels are preserved. Arrow keys follow reading
direction, Home/End move to chapter boundaries, and editing controls retain their
normal keys. Reader appearance preferences use the renderer profile's localStorage;
they are not a migration of the application's settings database.

A double-page spread saves its first logical page only after both images decode.
Fetch failures, decode failures and persistence failures have separate retry paths.
Transient page handles are discarded when their chapter query unmounts, and book
opening waits for fresh chapter/progress reads rather than using stale grants.

Background validation: 76 .NET cases, five reader-service cases and five navigation
helper cases pass. Nova type checks, Electron/renderer builds and the C# server
build pass. Interactive checks are deferred at the user's request.
Earlier packaged observations verified import, a decoded first image and its
page-zero save only; see [desktop-verification.md](desktop-verification.md).
The existing installer predates these latest reader features and needs refreshing
before their packaged visual verification.
