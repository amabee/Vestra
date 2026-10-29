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

59 runtime cases pass with the optional manga artifact test enabled. That test
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

These checks resolve metadata only. They do not verify image downloads, decoder
support, reader layout or progress tracking. Providers can change independently.

## Remaining scope

Nova accepts manga-provider entries into a separate registry, never the anime
playback registry. The Manga navigation item supports source selection, title
search, chapters and page-by-page reading with buttons and Left/Right keys.
Chapter downloads, double-page/RTL layouts and host-side search ranking remain
pending. Full Seanime manga parity is not claimed.

## Reader and image-delivery pass

Main retains page URLs and headers; the renderer receives only opaque handles.
The private C# image command uses pinned-public-address HTTPS, an exact image-host
redirect scope, a 10-second deadline and a 2 MiB cap. JPEG/PNG/WebP/GIF/AVIF MIME
types are accepted; SVG/HTML, non-success HTTP responses and empty/oversized data
fail visibly. MIME is checked; the native decoder validates image contents.

Only the selected page is fetched, with Retry on failure. Unobserved image-query
data is discarded. The reader sorts metadata by index. Progress saves after
successful image decode through Nova's existing atomic JSON storage driver.
Writes are serialized and validated against a loaded chapter/page count, scoped
to provider/book. This reading-progress repository remains TypeScript; it is not
a port of Seanime's database. The C# provider store is separate and unchanged.

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
