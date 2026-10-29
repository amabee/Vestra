# Vestra C# server and provider worker

Development builds require the .NET 10 SDK. Windows x64 desktop packages now bundle
a self-contained worker and TypeScript compiler; installed execution does not use
the development DLL or SDK. See [worker-packaging.md](../../docs/worker-packaging.md)
for packaging commands and verification limits. From the repository root:

```powershell
pnpm build:server
pnpm test:server
pnpm test:server:bridge
```

`Vestra.slnx` includes the host, provider library and runtime tests.

## Provider worker

```powershell
dotnet apps/server/bin/Release/net10.0/Vestra.Server.dll --provider-worker
```

This mode has no HTTP listener. It reads newline-delimited JSON from private
stdin and writes only protocol JSON to stdout. The first message is a protocol-1
readiness record. EOF ends the worker; Nova stops its child on application exit.

Commands carry a request `id`:

```json
{"id":"1","kind":"load","provider":{"id":"example","source":"class Provider { /* methods */ }","hosts":["example.com"],"preferences":{}}}
{"id":"2","kind":"call","providerId":"example","method":"search","args":[{"query":"Example","dub":false,"year":0,"media":{}}]}
{"id":"3","kind":"unload","providerId":"example"}
{"id":"4","kind":"list"}
```

Responses are `{id,ok:true,value}` or `{id,ok:false,error}`. A `capabilities`
command reports bindings and flags Goja engine-port/full Seanime parity as
incomplete. The supported native
methods are `search`, `findEpisodes`, `findEpisodeServer`, and `getSettings`.
Missing methods fail loading. Result identities are stamped by the host.

The worker uses Jint 4.17.0, creates an engine/Provider instance per call, and
supplies `fetch`, response `text/json`, basic response headers, a quiet console
and `$getUserPreference`. Only structured JSON crosses the host boundary.
This is a compatibility subset, not a port of Goja or all Seanime bindings.

Limits: 32 loaded providers, 1 MiB source, 2 MiB input/result/HTTP body,
64 MiB interpreter allocation budget, 1M statements, recursion 128, 32 fetches
and a 10-second operation deadline. Nova adds a 15-second external deadline and
kills the worker on active cancellation. Nova restarts it on the next request
and reloads successful definitions without retrying the interrupted call.
Jint constraints are cooperative and this
worker is not an OS privilege or hard memory sandbox.

Networking uses exact HTTPS host grants on port 443, public destination addresses,
normal certificate verification and checked redirects. No proxy, shared cookie
jar or anti-bot bypass is provided. Fetch IO currently blocks its dedicated
execution lane; concurrent fetch scheduling remains pending.

## Nova development preview

Nova's **Sources** screen can now import local JavaScript/TypeScript providers,
configure websites/preferences/servers, enable or disable sources and check the
runtime. Build the worker, start Nova, and use **Import script**. The environment
config below is an optional first-run seed; after that Nova uses its persisted
managed copies. See [source-management.md](../../docs/source-management.md).

```powershell
pnpm build:server
$env:VESTRA_CSHARP_PROVIDERS = (Resolve-Path apps/server/providers.example.json).Path
pnpm --filter @vestra/nova dev
```

The example refers to the existing local Seanime-Providers reference tree; it is
not downloaded or bundled. `sourcePath` resolves relative to the configuration
file. Add every explicitly authorized upstream API/embed hostname to `hosts`;
the example grants the AnimeSaturn origin and its observed nested-player host. A missing grant fails
visibly rather than allowing arbitrary destinations. An optional
`VESTRA_CSHARP_SERVER_DLL` overrides the compiled DLL path.

The preview registers C# sources and a playback adapter in Nova's existing
registries. Existing QuickJS extensions remain on their current path. Packaged
builds ignore this development environment switch. TypeScript global Provider
scripts are transpiled by Nova before execution in C#. Unsupported crypto,
Buffer/URL operations and browser automation remain unavailable. Search supplies a minimal media object, not complete
AniList metadata, and stream resolution selects the configured preferred server
or the first advertised server when no preference is supplied.

Registered provider streams now use native mpv. The renderer receives opaque
handles; main resolves the selected episode on demand and forwards headers and
subtitle URLs to mpv. Signed URLs are refreshed on replay. Local playback clears
remote options, and a native stream error does not fall back to Chromium with an
opaque locator. Resolution chooses the first playable rendition; quality/mirror
selection remains pending. Subtitle language/title metadata is not explicitly
assigned to mpv tracks yet.

The installed mpv passed a local HLS audio fixture with required headers on the
playlist, segment and subtitle requests, plus option reset checks. Real provider
HTTPS/CDN playback and the complete Electron visual flow remain unverified.

```powershell
$env:VESTRA_TEST_MPV = (Resolve-Path .tools/mpv/mpv.exe).Path
pnpm test:playback
```

Without `VESTRA_TEST_MPV`, only the handle/validation test runs. The native fixture
uses an isolated local HTTP server; production registration requires HTTPS.
mpv load options follow its [official manual](https://mpv.io/manual/stable/).

## Optional upstream artifact test

The self-contained tests use original fixtures. To additionally run the existing
AniDB JavaScript artifact against deterministic offline HTTP responses:

```powershell
$env:VESTRA_TEST_SEANIME_PROVIDER = (Resolve-Path Seanime-Providers/src/anime/anidb/provider.js).Path
pnpm test:server
```

This tests source execution with fixture HTML/JSON; it does not establish that the
live site or streams work. No upstream provider source is vendored into this work.

## HTML and base64 compatibility

The C# runtime now supplies a read-only `Doc` / `LoadDoc` subset through
[AngleSharp](https://github.com/AngleSharp/AngleSharp). No browser context,
resource loader or script engine is attached to parsed documents. JavaScript sees
numeric selection handles and JSON values, never AngleSharp or other CLR objects.

Supported selections: `find`, `length()`, `text`, `html`, `attr`, `attrs`, `data`,
`eq` (including negative indices), `first`, `last`, `children`, `parent`, `filter`,
`not`, `has`, `is`, `each`, and `map`. This is not the complete goquery API or a
browser DOM. Callbacks receive selection wrappers as Seanime providers expect.
`atob` and `btoa` support binary strings; `btoa` rejects non-Latin-1 input.

Per call, HTML parsing is capped at 16 documents and 4 Mi characters total;
selection allocation is capped at 4096 handles, 20,000 nodes per selection and
100,000 cumulative node references. Native parser work uses bounded inputs and
the worker's external deadline; these are not hard OS memory guarantees.

The optional second source test runs the local AnimeSaturn mirror provider through
search, episodes, HTML iframe extraction and stream resolution with offline data:

```powershell
$env:VESTRA_TEST_SEANIME_DOM_PROVIDER = (Resolve-Path Seanime-Providers/src/anime/animesaturnmirror/provider.js).Path
pnpm test:server
```

## HTTP host foundation

```powershell
dotnet run --project apps/server/Vestra.Server.csproj
```

Without `--provider-worker`, the host logs an OS-assigned loopback port and serves
`GET /api/v1/health` and `GET /api/v1/capabilities`. Provider execution is available
only through the separate worker protocol. The HTTP host exposes no provider,
credential, media or filesystem endpoint. Authentication and origin checks are
required before adding sensitive HTTP endpoints.

See [the migration inventory](../../docs/csharp-migration.md).

## Buffer and URL compatibility

The runtime includes bounded subsets of [Node Buffer](https://nodejs.org/api/buffer.html)
and [URL APIs](https://nodejs.org/api/url.html). They do not grant filesystem,
network or CLR access; URLs passed to fetch still go through host grants.

- `Buffer.from` accepts strings and bounded array-like byte inputs (including
  Uint8Array). `alloc`, `isBuffer`, `byteLength`, indexed bytes and `toString`
  with start/end are supported. Encodings: UTF-8, Latin-1/binary, hex, base64 and
  base64url. Buffers are capped at 1 MiB. Invalid hex/base64 are rejected more
  strictly than Node. ArrayBuffer overloads, numeric read/write helpers, concat
  and Node-specific slicing behavior are not implemented.
- `URLSearchParams` supports strings, records and pair sequences, duplicate keys,
  form encoding, get/getAll/has/set/append/delete, size, sort, forEach and iteration.
  Iterators snapshot entries; lone-surrogate form encoding is not normalized to
  the WHATWG replacement character. This is not full web-platform conformance.
- `URL` supports absolute/relative HTTP(S) URLs, an optional base, href, origin,
  protocol, host, hostname, port, pathname, search, hash and live searchParams.
  Only href and search have setters. Credentials and non-HTTP schemes are
  rejected; URL strings are capped at 8192 characters. Parsing uses .NET Uri,
  not a complete WHATWG parser. Network access remains HTTPS-only even though
  the URL helper can parse HTTP.

43 runtime cases passed with all three optional upstream source tests enabled.
The third source is DonghuaStream; its base64-encoded embed was resolved against
offline responses, without contacting the live service:

```powershell
$env:VESTRA_TEST_SEANIME_BUFFER_PROVIDER = (Resolve-Path Seanime-Providers/src/anime/donghuastream/provider.js).Path
pnpm test:server
```

## Live AnimeSaturn repair

The example enables the explicit `animesaturn-nested-player-v1` profile. It keeps
the upstream script unchanged and overrides stream extraction after transpilation.
The repair follows at most three static iframe pages, rejects cycles, extracts
literal `primary` or `file` URLs, and preserves the player Referer. It executes
no page JavaScript and grants no additional hosts on its own.

`pnpm check:providers:live` uses this profile and explicit grants for
`animesaturn.ro` and `cdn2.megaplay.su`. The latest check completed search,
episodes and stream resolution; its HLS manifest returned HTTP 200. No media
segments or live playback were tested. The current DonghuaStream script resolves
Battle search results; Server 1's manifest responds 403, while Server 2 responds
200 with valid HLS. The example explicitly selects preferredServer: Server 2;
invalid server names fail visibly. AniDB's original source is now absent from
the reference tree and is reported as missing by the diagnostic.
The recorded results and API limits are in
[provider-runtime-status.md](../../docs/provider-runtime-status.md).

## Response parity and request helpers

Seanime's text()/json() body methods are synchronous. Vestra now implements that
contract; awaiting either still works. Invalid JSON returns null. Responses expose
statusText and headers through both a map and get(). Headers supports construction,
append/set/delete/get/has and iteration. Fetch serializes plain JSON objects,
URLSearchParams and text-only FormData (including getBuffer/getContentType).
Binary uploads, full browser fetch semantics and per-fetch AbortSignal are still
unsupported. See [goja-port-status.md](../../docs/goja-port-status.md) for the
complete current gap inventory.

## Manga worker support

Load commands can specify type: manga-provider to select search, findChapters,
findChapterPages and getSettings instead of the online-stream contract. The
capabilities command lists supported extension types. Nova's preview now accepts
manga sources into a separate reader registry. Choose Manga to search, select
chapters and read one page at a time. Progress persists after successful image
decode in the C# worker's versioned, atomic reading-progress store. Existing Vestra
progress imports once without replacing newer C# positions; old files remain as
recovery copies. Set `VESTRA_PROVIDER_DATA_DIR` for standalone worker persistence;
Nova supplies its app-data subdirectory automatically. Images pass through opaque handles and the C# guarded transport, with
raster MIME checks and a 2 MiB cap. The example config includes MangaStash.
The UI was built and service-tested, but visual QA remains unverified because
the desktop helper could not activate the test window.
See [manga-provider-status.md](../../docs/manga-provider-status.md) for commands,
validation boundaries and live metadata results.
