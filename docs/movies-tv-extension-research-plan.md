# Movies/TV extension research and implementation plan

Research date: **2026-11-02**, Asia/Singapore.

Status: **initial research completed; subsequent implementation updates are linked below.**

VixSrc was subsequently implemented and native samples verified; see
[VixSrc implementation](vixsrc-source.md). The user then restricted new candidates
to APIs and allowed an optional self-hosted service. See the
[API-only follow-up and Vyla connector](api-source-connectors.md) for current
disposition. The inventory below preserves initial research observations.

## Decision

Keep Vestra's native player and its own extension format as the primary path.
Do not install a collection of iframe URLs and present them as working native
streaming extensions.

**Recommended next step:** a small **VixSrc native-playback feasibility investigation**,
with a strict movie + TV proof before implementation. It exposes a working public
catalogue endpoint, but its documented playback URLs are HTML players. A direct
media contract is **not yet verified**. If the investigation cannot establish a
maintainable native path, stop that candidate rather than shipping another broken
source.

**Alternative with the clearest documented native-media contract:** Vyla Stream
API. Its playback output is SSE containing playable source candidates, but it is
**self-hosted only**, not a public streaming endpoint. Treat it as an optional
service integration, not a zero-setup replacement for MovieBox or KissKH.

**Useful separate enhancement:** evaluate SkipDB for movie/TV skip timestamps.
It is a timestamp service, not a source of videos. Keep this work separate from
adding a streaming extension.

## Scope and evidence

Starting directory: [API / Embedding Sites](https://rentry.co/onbksdgu), whose page
reported an edit on 2026-10-27. It contains:

- **39** API/embedding entries, including two anime-only entries and a third that
  now advertises anime rather than movies/TV.
- **2** self-hosted project entries.
- **6** utility entries. Some contain separately named alternatives, such as
  Libre Subs and IMDxAPI; those are addressed below too.
- **66 unique non-community URLs** across those entries, aliases, repositories,
  and linked documentation. Every one received an initial HTTP check. The audit
  additionally followed primary documentation and selected public examples.

HTTP 200 is **not** proof of working playback. Some URLs return only a JavaScript
application shell. The distinctions used throughout this document are:

| Evidence                 | Meaning                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Documentation reviewed   | Public integration instructions or client-rendered documentation text was inspected.                                                   |
| JSON observed            | A bounded public GET returned JSON; its actual fields were inspected.                                                                  |
| Client-only              | Public HTML/client assets were readable, but a complete independent API contract was not established.                                  |
| Blocked                  | The requested public page returned a challenge or denial. Its contract remains unverified.                                             |
| Native playback verified | Requires actual media/container validation; **none of the newly listed services has reached this release gate in this research pass**. |

The readable Rentry HTML was used. Its `/raw` endpoint requested an access code;
that restriction was not bypassed. No accounts were created, API keys obtained,
community messages sent, packages installed, media libraries downloaded, or
authenticated/admin endpoints accessed. Client assets were read as text, not
executed. No iframe player or advertisement scripts were run.

## Why most of these are not drop-in Vestra extensions

An iframe URL is a web application. An mpv source needs a usable media URL plus
the required headers, subtitles, and a way to refresh expiring delivery URLs.
A path named `/api/embed/...` can still return HTML.

Keep these roles separate:

1. **Catalogue:** search, titles, artwork, genres, release dates, seasons and IDs.
2. **Availability:** whether a particular provider carries that exact movie or episode.
3. **Playback:** direct HLS/MP4 candidates, required headers, renditions and refresh.
4. **Enhancements:** subtitle lookup and intro/credit timestamps.

Several services provide only role 1 or role 4. Others provide a browser player
that internally handles roles 2–4 without documenting them for native clients.
Marketing claims about speed, 4K, ad-free operation, or uptime were **not benchmarked**.

## Complete streaming/embedding inventory

“Native gap” below means no documented/observed direct-media contract was verified
in this pass; it does not mean extraction is impossible. Unless explicitly noted,
authentication requirements for undocumented internal endpoints remain unknown.

|   # | Entry and primary documentation                                                                                                                                                                         | What was checked                                                                                                                                                                                                                                                  | Vestra assessment                                                                                                                                                      |
| --: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | [0VIDADS](https://0vidads.top/), [documentation](https://0vidads.top/documentation), [VidStuck](https://vidstuck.cc/), [ZXCSTREAM](https://zxcstream.cc/)                                               | All three home URLs returned 200. 0VIDADS links a documentation route, which also returned a JS shell. Public client material includes TV embed examples. ZXCSTREAM's checked `/documentation` route returned 404; do not assume identical docs across the group. | Client-only evidence. Not ready for native integration.                                                                                                                |
|   2 | [2embed.cc](https://www.2embed.cc/#api), [2embed.skin](https://2embed.skin/)                                                                                                                            | Both pages returned matching integration material. Documented IMDb/TMDB movie/TV embeds and a separate `api.2embed.cc` metadata API. A movie JSON response and trending response were observed.                                                                   | Useful catalogue/ID research. Movie JSON contains `embed_imdb`/`embed_tmdb`, not a verified native stream URL.                                                         |
|   3 | [2embed.stream](https://2embed.stream/#docs)                                                                                                                                                            | Public page returned 200 and describes IMDb/TMDB plus anime player entry points.                                                                                                                                                                                  | Treat separately from 2embed.cc. The directory repeats `.skin` under both entries, but that does not establish a shared backend or contract. Native gap.               |
|   4 | [animeTVplus Embed](https://embed.animetvplus.site/)                                                                                                                                                    | Public page returned 200 with an anime episode embed example.                                                                                                                                                                                                     | Anime-only in the directory; outside the next Movies/TV extension scope. No Movies/TV contract verified.                                                               |
|   5 | [Atlantic](http://embed.atlantic.st/)                                                                                                                                                                   | Listed HTTP URL returned a JS app. Client documentation describes `https://atlantic.st/embed/movie/{tmdbId}` and TV season/episode paths.                                                                                                                         | Browser embed contract, native gap. Resolve the HTTPS canonical host before a future integration; do not use the listed plaintext URL for native requests.             |
|   6 | [Cinemaos](https://cinemaos.tech/embed)                                                                                                                                                                 | Returned HTTP 403 with a browser challenge.                                                                                                                                                                                                                       | Documentation/playback unverified. Hold; no challenge bypass attempted.                                                                                                |
|   7 | [CineSRC docs](https://cinesrc.st/docs)                                                                                                                                                                 | Readable movie/TV iframe instructions, TMDB IDs, TV query parameters, resume time, preferred quality and player events. Optional premium-token parameter is documented.                                                                                           | Clear embed integration, not a direct-media API. Do not make premium-token access a default requirement.                                                               |
|   8 | [Cinextream](https://cinextream.cc/)                                                                                                                                                                    | Readable docs explicitly describe `/api/embed/movie/{id}` and TV variants as HTML/Vidstack embeds. Page title also says Cinetaro; examples reference `.net` while the directory uses `.cc`.                                                                       | `/api` does not mean JSON here. Record hostname/TV-route inconsistencies and verify before using any example. Native gap.                                              |
|   9 | [Cinezo](https://cinezo.live/)                                                                                                                                                                          | Docs show `player.cinezo.live/embed/movie/{tmdbId}`, TV season/episode paths, anime routes and progress events.                                                                                                                                                   | Browser player with a separate playback host. Native gap.                                                                                                              |
|  10 | [Fmov](https://fmov.my/), [docs](https://fmov.my/docs)                                                                                                                                                  | Home/docs returned JS shells. Client documentation describes movie/series/anime embeds and no embed API-key requirement. Some client examples use different TV route forms.                                                                                       | Embed candidate only until exact route behavior and native extraction are verified. Internal source names are not stable API contracts.                                |
|  11 | [frameXTV](https://framextv.xyz/api)                                                                                                                                                                    | Directory URL redirects to `framextv.cc/api`. Client assets contain several resolver/stream references, but the URL itself serves an app, not an API schema.                                                                                                      | More investigation required. Do not build against arbitrary internal routes based only on their names.                                                                 |
|  12 | [Mapple endpoints](https://mappletv.uk/docs/getting-started/endpoints), [events](https://mappletv.uk/docs/getting-started/events)                                                                       | Readable docs: playback is served from `mapple.fun`, with movie paths and dash-separated TV IDs/season/episode. Event documentation requires the current player origin.                                                                                           | Well-documented browser integration. Native gap. The docs site and player site are different hosts.                                                                    |
|  13 | [Nxsha Embed](https://web.nxsha.app/embed)                                                                                                                                                              | Returned an app/landing shell. A complete standalone Movies/TV API contract was not recovered from the checked page.                                                                                                                                              | Unverified, not release-ready.                                                                                                                                         |
|  14 | [NontonGo](https://nontongo.win/)                                                                                                                                                                       | Readable IMDb/TMDB movie/TV iframe routes and AniList/MAL anime routes. The page discloses player pop-ups.                                                                                                                                                        | Embed contract only; direct playback unverified. Do not execute browser scripts merely to call this a native source.                                                   |
|  15 | [PrimeSRC](https://primesrc.me/)                                                                                                                                                                        | Public client docs describe embeds, `list_servers`, and recent movie/episode JSON. Movie and TV server-list examples and recent movies returned JSON.                                                                                                             | Promising availability/feed research, **not yet native playback**: tested server records contain names/file metadata but no playable URL. See detailed findings below. |
|  16 | [SuperEmbed](https://www.superembed.stream/)                                                                                                                                                            | Docs describe `multiembed.mov` movie/TV embeds, a `directstream.php` player path, availability checks and custom subtitles. IMDb/TMDB inputs.                                                                                                                     | “Direct stream” naming is insufficient evidence of a direct MP4/HLS API. Player/host extraction remains unverified.                                                    |
|  17 | [Stellar API](https://stellar.rip/en/api)                                                                                                                                                               | Extensive readable embed documentation: URL formats, parameters, languages, messages and referrer considerations.                                                                                                                                                 | Strong browser-player documentation; native gap. Do not transfer referrer assumptions between hosts.                                                                   |
|  18 | [TryEmbed](https://tryembed.us.cc/)                                                                                                                                                                     | Current page advertises AniList/MAL anime embeds and directs Movies/TV users to another service.                                                                                                                                                                  | Directory Movies/TV label is stale for the reviewed contract. Exclude this host from the Movies/TV shortlist.                                                          |
|  19 | [Velarium endpoints](https://velarium.cc/en/docs/endpoints), [events](https://velarium.cc/en/docs/events)                                                                                               | Readable language-prefixed `/watch/movie` and `/watch/tv` iframe routes. Supports season 0; UI language does not establish matching audio availability.                                                                                                           | Browser embed candidate. Native gap. Preserve specials and distinguish UI language from audio/subtitle language.                                                       |
|  20 | [VidAPI.ru docs](https://vidapi.ru/api)                                                                                                                                                                 | Readable IMDb/TMDB movie/TV iframe docs. Actual player host is `vaplayer.ru`; multiple episode route forms and subtitle parameters are documented.                                                                                                                | Not a native-media API. Site-generation features are unrelated to a Vestra streaming extension.                                                                        |
|  21 | [Viduki](https://www.viduki.net/#api)                                                                                                                                                                   | Readable player docs and events. Its “4K AI” feature is described as client-side WebGPU upscaling of generally lower-resolution streams.                                                                                                                          | Do not label extracted video as native 4K because an iframe can upscale it. Native gap.                                                                                |
|  22 | [VidCore.net](https://vidcore.net/)                                                                                                                                                                     | Redirects to `vidcore.io`; public client docs describe IMDb/TMDB `/movie/{id}` and `/tv/{id}/{season}/{episode}` players.                                                                                                                                         | Browser embed contract. Keep distinct from VidCore.org; similar branding is not proof of the same provider.                                                            |
|  23 | [VidCore.org](https://www.vidcore.org/#documentation)                                                                                                                                                   | Readable `/embed/movie` and `/embed/tv` documentation, player options and events.                                                                                                                                                                                 | Separate service entry; native gap. Advertised media/uptime claims remain untested.                                                                                    |
|  24 | [VidFast](https://vidfast.vc/)                                                                                                                                                                          | All seven directory aliases were checked and resolve to `.vc`. Client docs describe movie/TV players, resume options, themes and events.                                                                                                                          | Established embed-shaped contract, not verified native media. Alias audit appears below.                                                                               |
|  25 | [VidFlix](https://vidflix.club/), [docs route](https://vidflix.club/docs)                                                                                                                               | Home/docs returned an app shell; client docs describe iframe integration. A read-only internal movie API example returned 403.                                                                                                                                    | Hold native work. Internal JSON references in a bundle do not establish usable public access; do not bypass the denial.                                                |
|  26 | [VidLink](https://vidlink.pro/)                                                                                                                                                                         | Readable TMDB movie/TV and MAL anime embed docs, customization and progress data.                                                                                                                                                                                 | Browser integration documented; native stream API not verified.                                                                                                        |
|  27 | [VidHawk](https://vidhawk.buzz/)                                                                                                                                                                        | Readable AniList/MAL anime embed docs, server options and ticket-based player entry points.                                                                                                                                                                       | Anime-focused, outside this Movies/TV addition. A ticket/player URL is not automatically a direct HLS contract.                                                        |
|  28 | [VidNest](https://vidnest.fun/)                                                                                                                                                                         | Readable TMDB movie/TV and anime embed documentation with player controls and resume options.                                                                                                                                                                     | Browser embed contract; native gap.                                                                                                                                    |
|  29 | [vidrock](https://vidrock.net/)                                                                                                                                                                         | Returned a JS app. Client documentation/routes include movie and TV embed/player paths.                                                                                                                                                                           | Client-only integration evidence; no independent native-media contract verified.                                                                                       |
|  30 | [VidRift docs](https://vidrift.net/docs)                                                                                                                                                                | Readable iframe docs use `embed.vidrift.net`, with TMDB/AniList inputs, progress events, subtitles and episode controls. Describes IntroDB/AniSkip use inside its player.                                                                                         | Rich browser integration, but no direct native-source contract established. Its enhancement integrations are ideas, not APIs to copy wholesale.                        |
|  31 | [VixSrc](https://vixsrc.to/)                                                                                                                                                                            | Readable IMDb/TMDB movie/TV embed docs and `/api/list/{type}` catalogue endpoint. Movie catalogue returned JSON ID records. A sample movie URL returned a JS player shell without a video element/manifest in the initial HTML.                                   | Recommended **feasibility investigation**, not immediate release. Catalogue availability is demonstrated; native extraction is not.                                    |
|  32 | [VidSrc.sh docs](https://vidsrc.sh/vidsrc/docs), [domain status](https://vidsrc.domains/)                                                                                                               | Main site, listed mirrors and status page returned 200. Readable IMDb/TMDB movie/TV embed docs include resume, next-episode and subtitle options.                                                                                                                 | Browser integration documented. Do not confuse these domains with VidSrc.to or historical VidSrc services.                                                             |
|  33 | [VidSrc.to](https://vidsrc.to/#api)                                                                                                                                                                     | Separate public page returned 200 with its own embed/API examples.                                                                                                                                                                                                | Separate identity and contract; no verified direct-media API in this pass. Do not inherit another VidSrc extractor solely by name.                                     |
|  34 | [VidUP](https://vidup.to/)                                                                                                                                                                              | Public client docs describe movie/TV player URLs and options.                                                                                                                                                                                                     | Embed contract only; native gap. Directory anime coverage was not independently established.                                                                           |
|  35 | [Vidy](https://www.vidy.st/#docs)                                                                                                                                                                       | Readable TMDB movie/TV and AniList anime player paths and parent messages. Explicitly leaves catalogue/account/watchlist duties to the embedding application.                                                                                                     | Fits an optional browser player, not current native extension requirements without extraction.                                                                         |
|  36 | [Vidzee](https://vidzee.wtf/#api-docs)                                                                                                                                                                  | Readable `player.vidzee.wtf/embed/...` and `/v2/embed/...` examples. TMDB movie/TV addressing.                                                                                                                                                                    | Two player variants, neither demonstrated as native media.                                                                                                             |
|  37 | [Vidzen](https://vidzen.fun/#docs)                                                                                                                                                                      | Readable movie/player docs and advertised backend/server choices. IMDb/TMDB addressing is described.                                                                                                                                                              | Embed contract. Dashboard latency/quality claims are not a Vestra playback benchmark.                                                                                  |
|  38 | [Vyla Stream API overview](https://vyla.cc/stream-api/overview/index.md), [paths](https://vyla.cc/stream-api/reference/paths.md), [self-hosting](https://vyla.cc/stream-api/deployment/self-hosting.md) | Actual Markdown documentation specifies SSE playback events with playable candidates and separate subtitle/download JSON endpoints. Explicitly no public hosted streaming instance.                                                                               | Best documented native-media-shaped contract in this list, but requires a separately operated service and transport design. Optional path; not a zero-setup extension. |
|  39 | [ZoryvaX](https://zoryva.me/embed)                                                                                                                                                                      | Readable iframe docs: numeric TMDB for movies/TV, AniList for anime, resume and visibility controls. Explicitly does not accept IMDb on this endpoint.                                                                                                            | Clear embed contract; native gap. Do not send IMDb IDs here.                                                                                                           |

## Self-hosted projects

| Entry                                                                                                                                                                                                                        | Verified primary evidence                                                                                                                                                                                                                                                                                | Decision                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [poprink nano / Shiopa](https://github.com/mohameodo/nano), [architecture](https://github.com/mohameodo/nano/blob/main/docs/how-it-works.md), [configuration](https://github.com/mohameodo/nano/blob/main/docs/configure.md) | Repository is not archived. Current README calls it Shiopa. Architecture documents TMDB search, `/api/scrape`, a provider registry and a media proxy. Configuration says optional providers install as encrypted modules. GitHub did not report a recognized repository license in the checked metadata. | Useful architecture comparison; not a public hosted API or automatically portable collection of plain source scripts. Review the actual source availability and terms before reuse; do not run its installer for this research. |
| [P-Stream listing](https://github.com/xp-technologies-dev/p-stream)                                                                                                                                                          | Repository metadata reports **archived**. Current README calls it Z-Stream and says provider code is not open source, while pointing to a different original repository for self-hosting. GitHub reports AGPL-3.0 for the listed repository.                                                             | Not a current ready-made scraper backend. Do not assume its advertised provider collection is included. Hold.                                                                                                                   |

## Utility APIs — useful, but not video sources

| Entry and documentation                                                                                                                                                    | Verified contract and requirements                                                                                                                                                                                                                                                                                                                    | Vestra use                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [TheIntroDB](https://theintrodb.org/), [current client reference](https://theintrodb.github.io/theintrodb-npm/), [v4 README](https://github.com/TheIntroDB/theintrodb-npm) | Current primary client docs target API v4. `GET /media` is public; writes/mapping require the current user's key. TVDB-primary identity, alternate TMDB/IMDb IDs, episode-order mappings, segment arrays and nullable start/end semantics are described. Full v4 wire/base-URL verification is still required before coding.                          | Candidate movie/TV skip provider. Do not implement against a remembered older API or copy anime-only assumptions.                                                                                                  |
| [SkipDB docs](https://skipdb.tv/docs), [repository](https://github.com/SkipDB-TV/skipdb)                                                                                   | Public `GET https://api.skipdb.tv/api/segments` accepts IMDb plus optional season/episode and stream duration in seconds. Docs state 120 reads/minute. Segment boundaries use milliseconds; responses include match confidence and duration-adjustment information. A documented example returned JSON. Code/data licenses are separately documented. | Strong candidate for a read-only skip integration. The tested sample was marked **out-of-range**, so receiving timestamps is not permission to auto-skip blindly.                                                  |
| [Wyzie Subs](https://sub.wyzie.ru/), [intro](https://docs.wyzie.io/subs/intro), [HTTP reference](https://docs.wyzie.io/subs/usage/direct)                                  | `.ru` currently redirects to `.io`. Docs require an API key, including free-tier access obtained through email verification. Current docs describe 1,000 free requests/day, separate search/download costs, release matching, filters and pagination. No key was acquired or used.                                                                    | Optional subtitle provider with user-supplied credentials or a separately operated backend. Never bundle a shared developer key. Not a video source.                                                               |
| [Libre Subs alternative](https://libre-subs.fifthwit.net/) and [wyzie-lib package listing](https://www.npmjs.com/package/wyzie-lib)                                        | Both directory-linked pages returned HTTP 403/challenges. Wyzie's own documentation was readable, but equivalent behavior of this alternative was not verified.                                                                                                                                                                                       | Hold independent Libre Subs integration; do not assume it inherits Wyzie's current contract, keys or limits.                                                                                                       |
| [TMDB documentation](https://developer.themoviedb.org/docs/getting-started)                                                                                                | Main consumer site returned a challenge, but official developer documentation was readable. API registration/key and terms are documented. This is metadata/IDs/images, not media delivery.                                                                                                                                                           | Reuse Vestra's existing catalogue integration rather than introduce a second conflicting catalogue state. Use thumbnail-size artwork.                                                                              |
| IMDxAPI alternative from the directory                                                                                                                                     | The link goes to [an encoded Rentry index section](https://rentry.co/FMHYB64#tiff), rather than directly to API documentation. That section contains another paste link; a canonical IMDxAPI contract was not established.                                                                                                                            | Unresolved. Do not treat this indirection as a verified TMDB replacement.                                                                                                                                          |
| [AniCore](https://anicore.dpdns.org/)                                                                                                                                      | Client reference material includes public `/v1` catalogue/search/movie/season/episode routes and authenticated account routes. `/v1/stats` returned structured catalogue/coverage JSON. No native movie/TV media contract was verified.                                                                                                               | Possible metadata/ID/episode research. Despite the directory's anime label, current client material also references movies/series. Do not classify catalogue streaming links as playable media without validation. |
| [Anikura docs](https://anikura.club/api)                                                                                                                                   | Readable free read-only JSON catalogue/comments documentation, no key required. `/api/v1/catalog` accepts MAL/AniList/TMDB/Anikura IDs; comments add an episode and paging. Docs specify catalogue/comments caching and discourage polling.                                                                                                           | Optional anime metadata/discussion enhancement; outside the new Movies/TV streaming provider scope.                                                                                                                |

## Detailed shortlist findings

### VixSrc: first native-extraction feasibility investigation

Sources: [primary docs](https://vixsrc.to/) and the documented
[movie catalogue](https://vixsrc.to/api/list/movie?lang=it).

- The tested catalogue returned 14,225 ID-only records with `tmdb_id` and `imdb_id`.
  This is a point-in-time count, not a durable capacity promise.
- This endpoint does not by itself supply searchable titles, episode details,
  quality choices, subtitles or direct media URLs.
- A movie page returned HTTP 200 but initial HTML had no video element or manifest
  configuration. Browser delivery/extraction needs separate evidence.
- Do not call catalogue order “Popular” or invent episode availability from a
  title's advertised total.

Before choosing this source, verify one movie and one multi-season episode in a
controlled browser observation, identify required headers/hosts and URL lifetime,
and establish that native extraction can be implemented without a persistent
browser or runtime challenge handling. Stop if those conditions cannot be met.

### PrimeSRC: useful JSON, but the sample is not a source URL

Source: [PrimeSRC's public client documentation](https://primesrc.me/).

Observed public examples:

- `GET /api/v1/list_servers?type=movie&imdb=tt0848228`
- `GET /api/v1/list_servers?type=tv&tmdb=32726&season=1&episode=1`
- `GET /api/v1/latest_movies`

The first two returned `info` and `servers`. Server records described providers,
file names/sizes, language and quality fields, but **contained no media URL**.
Some fields were null; one movie response placed an IMDb-shaped value in the
`tmdb_id` field. Validate identifier shape, not just the field name.

The recent-movie sample returned `count`/`results` with IDs and server names.
That could inform availability discovery, but it does not solve extraction.
Do not download full catalogue dumps or promise working host extractors as part
of a simple API wrapper.

### 2embed.cc: real metadata JSON, HTML playback links

Sources: [public docs](https://www.2embed.cc/#api) and the documented
[movie endpoint](https://api.2embed.cc/movie?imdb_id=tt0111161).

The sample returned title metadata and embed links. Trending also returned a
large metadata response. This is not proof of a native stream API. Avoid using
this as a second uncoordinated metadata identity system, fetching full responses
on every scroll, or loading original-size artwork from its metadata.

### Vyla: optional native-capable service, not a hosted free API

Sources: [playback contract](https://vyla.cc/stream-api/reference/paths.md),
[media data](https://vyla.cc/stream-api/reference/media-data.md),
[self-hosting](https://vyla.cc/stream-api/deployment/self-hosting.md).

- Playback uses `/movie?id=...` or `/tv?id=...&season=...&episode=...`, with optional
  `/api` prefixes. Inputs are TMDB IDs.
- Responses are SSE, with metadata, playable-source and completion events. They
  are not a single JSON document. An empty successful result is possible.
- Separate subtitle/download endpoints are documented. Returned media candidates
  can expire and may depend on the deployment's proxy and upstream headers.
- It needs an operated Node service; its docs say no hosted public streaming
  instance exists. TMDB configuration and source availability also matter.

Architecture implications: QuickJS's current request/response fetch bridge does
not automatically provide incremental SSE consumption. Do not wait for every
provider to finish and call that progressive playback. Nor should an extension
silently gain arbitrary loopback/private-network access to reach a self-hosted
service. A future service connector needs explicit configuration, bounded
transport and a deliberate local-service policy. No service was deployed here.

### SkipDB and TheIntroDB: timestamp matching must be version-aware

Sources: [SkipDB reference](https://skipdb.tv/docs) and
[TheIntroDB v4 reference](https://github.com/TheIntroDB/theintrodb-npm).

The tested SkipDB request returned valid JSON whose selected segments were marked
`out-of-range` for the requested duration. That is evidence that edition/duration
matching must affect the skip UI. TheIntroDB additionally documents episode-order
mappings and multiple segments of a type. Preserve these distinctions rather
than turning every result into a single unconditional intro/ending pair.

## Alias and address audit

- **0VIDADS group:** `.top`, `vidstuck.cc` and `zxcstream.cc` all returned 200 at
  their own URLs. They are grouped by the directory, not independently proven to
  be interchangeable.
- **2embed:** `.cc` and `.skin` returned matching docs. `.stream` has its own
  reviewed page. Do not merge identities based on the repeated directory alias.
- **frameXTV:** listed `.xyz/api` redirects to `.cc/api`.
- **VidCore.net:** redirects to `vidcore.io`. `vidcore.org` is a separate entry.
- **VidFast:** `.vc`, `.xyz`, `.pm`, `.net`, `.me`, `.io` and `.in` were all
  checked; all resolved to `https://vidfast.vc/` during this audit.
- **VidSrc.sh group:** `vidsrc.sh`, `vidsrc2.ru`, `vidsrc.ir`, `vsembed.ru`,
  `vsembed.su` and `vidsrc.domains` returned 200. The directory repeats
  `vsembed.ru`; it was counted once. Similar pages do not establish ownership or
  equivalent runtime behavior. VidSrc.to was checked separately.
- **Wyzie:** the listed subtitle and documentation `.ru` URLs redirect to `.io`.
- **Docs/player splits:** Mapple documents `mapple.fun`; Cinezo documents
  `player.cinezo.live`; VidAPI documents `vaplayer.ru`; VidRift documents
  `embed.vidrift.net`; Vidzee documents `player.vidzee.wtf`.

The 66-URL initial inventory and bounded additional responses are saved locally
under ignored `.tools/source-api-research/`. They are research evidence, not an
extension registry or a promise that every host is usable in all regions.

## Implementation plan — after this research is reviewed

Execution update: the first native source is implemented locally. See
[VixSrc implementation and verification](vixsrc-source.md). Registry publication
and the full manual player session remain release gates; the checkboxes below
distinguish completed implementation from those pending checks.

### Phase 1: prove a native source before writing its extension

- [x] Investigate VixSrc's current movie and TV player delivery using controlled
      runtime evidence; read the reverse-engineering skill at that stage.
- [x] Prove a playable HLS/MP4 response, not just an embed or HTTP 200 page.
- [x] Record exact request headers, redirect behavior, media/subtitle hosts,
      rendition labels and expiry behavior without publishing signed URLs or tokens.
- [x] Test a movie, an ordinary episode, a later season, and an unavailable item.
- [x] Verify how discovery and search obtain actual title metadata; do not invent
      names/popularity from an ID list.
- [ ] Stop or change candidate if a reliable native path cannot be demonstrated.

If VixSrc fails this gate, evaluate Vyla's optional service connector next. Keep
PrimeSRC as an availability/API research candidate until URL acquisition is
actually understood. Do not silently replace the native player with an iframe.

### Phase 2: fit the source into Vestra's existing architecture

- [x] Keep TMDB/IMDb/provider-specific IDs distinct, with verified cross-links.
      Use exact IDs and season/episode identity when available; do not auto-pick a
      remake or special by fuzzy title alone.
- [x] Keep the combined library independent of streaming-provider selection.
      Resolve provider availability on details, using the chosen provider there.
- [x] Reuse the native SDK's search/browse/episode/stream contract and existing
      source services. Document any genuinely missing host capability first.
- [x] Keep credentials in the existing host-side configuration path. If a new
      provider needs settings/secrets that the SDK cannot express, design that
      capability explicitly rather than hard-code a shared key in its payload.
- [x] Keep fixed source pagination stable, buffer leftovers and preserve the
      14-initial/7-additional UI behavior. Avoid fetching all providers/catalogues
      eagerly or discarding records when an upstream ignores a limit.
- [x] Cache metadata/batches separately from short-lived signed media URLs.
      Retain explicit refresh and bounded failure recovery.
- [ ] Use appropriate image sizes only where the CDN's resize contract is
      verified; never append guessed transform parameters to signed image URLs.

### Phase 3: native playback and failure handling

- [x] Return real quality/format values; do not manufacture HD/4K availability.
- [x] Forward required media and caption headers through the existing player.
- [x] Validate bounded media samples and, for HLS, a manifest plus a segment.
- [ ] Refresh expired URLs once, preserve rendition and playback position, then
      use finite fallback. Reject removed/replaced providers during pending work.
- [ ] Keep caption lookup non-blocking. Match language, release/version and timing
      where available; handle missing captions as a normal state.
- [ ] Exercise a real player session through startup, seek, resume, next episode
      and an expired-link recovery. Short HTTP samples alone do not pass this gate.

### Phase 4: publish one extension first

- [x] Add a Vestra-native manifest, precise host/permission declarations, artwork
      and plain installation instructions.
- [ ] Add fixture tests for wrong IDs, remakes/seasons, malformed responses,
      duplicate/empty pages, expiring URLs and caption failures.
- [x] Run a small live movie/TV matrix without installing into a user's profile.
- [ ] Only after native playback passes, add the pinned release to the registry.
      Do not list a nonfunctional install card merely because an embed URL exists.
- [ ] Leave other candidates in the research backlog; adding many unverified
      providers at once would make failures harder to diagnose.

### Separate enhancement track

- [ ] Prototype read-only SkipDB lookup with IMDb identity and stream duration.
- [ ] Add confidence/version handling and timestamp-bound validation before skip UI.
- [ ] Evaluate TheIntroDB v4 as an alternative/fallback with explicit episode-order
      mapping; do not auto-submit timestamp data.
- [ ] Consider Wyzie only with a deliberate credential/quota design. Preserve
      built-in provider subtitles first; a missing optional key must not block video.

## Completion checklist for this research pass

- [x] Enumerated every directory entry and all 66 unique non-community URLs.
- [x] Checked primary pages, discovered documentation, aliases and selected public
      read-only JSON examples.
- [x] Distinguished observed JSON from iframe HTML, and marketing from measured results.
- [x] Recorded challenge-blocked and client-only gaps without claiming playback works.
- [x] Wrote the shortlist, architectural constraints and staged implementation gates.
- [x] Implement a new source — VixSrc native source added after plan approval.

## Appendix: initial URL-by-URL HTTP audit

These are the 66 unique non-community URLs from the directory, including aliases
and linked utilities. Status is transport evidence only; it does not certify
playback, equivalent ownership, or a documented API. Additional documentation and
JSON checks are described in the sections above.

|   # | Requested URL                                                                                      | HTTP | Final URL when redirected                          |
| --: | -------------------------------------------------------------------------------------------------- | ---: | -------------------------------------------------- |
|   1 | [https://0vidads.top/](https://0vidads.top/)                                                       |  200 | Same address                                       |
|   2 | [https://vidstuck.cc/](https://vidstuck.cc/)                                                       |  200 | Same address                                       |
|   3 | [https://zxcstream.cc/](https://zxcstream.cc/)                                                     |  200 | Same address                                       |
|   4 | [https://www.2embed.cc/](https://www.2embed.cc/)                                                   |  200 | Same address                                       |
|   5 | [https://2embed.skin/](https://2embed.skin/)                                                       |  200 | Same address                                       |
|   6 | [https://2embed.stream/](https://2embed.stream/)                                                   |  200 | Same address                                       |
|   7 | [https://embed.animetvplus.site/](https://embed.animetvplus.site/)                                 |  200 | Same address                                       |
|   8 | [http://embed.atlantic.st/](http://embed.atlantic.st/)                                             |  200 | Same address                                       |
|   9 | [https://cinemaos.tech/embed](https://cinemaos.tech/embed)                                         |  403 | Same address                                       |
|  10 | [https://cinesrc.st/](https://cinesrc.st/)                                                         |  200 | Same address                                       |
|  11 | [https://cinextream.cc/](https://cinextream.cc/)                                                   |  200 | Same address                                       |
|  12 | [https://cinezo.live/](https://cinezo.live/)                                                       |  200 | Same address                                       |
|  13 | [https://fmov.my/](https://fmov.my/)                                                               |  200 | Same address                                       |
|  14 | [https://framextv.xyz/api](https://framextv.xyz/api)                                               |  200 | [https://framextv.cc/api](https://framextv.cc/api) |
|  15 | [https://mappletv.uk/](https://mappletv.uk/)                                                       |  200 | Same address                                       |
|  16 | [https://web.nxsha.app/embed](https://web.nxsha.app/embed)                                         |  200 | Same address                                       |
|  17 | [https://nontongo.win/](https://nontongo.win/)                                                     |  200 | Same address                                       |
|  18 | [https://primesrc.me/](https://primesrc.me/)                                                       |  200 | Same address                                       |
|  19 | [https://www.superembed.stream/](https://www.superembed.stream/)                                   |  200 | Same address                                       |
|  20 | [https://stellar.rip/en/api](https://stellar.rip/en/api)                                           |  200 | Same address                                       |
|  21 | [https://tryembed.us.cc/](https://tryembed.us.cc/)                                                 |  200 | Same address                                       |
|  22 | [https://velarium.cc/](https://velarium.cc/)                                                       |  200 | [https://velarium.cc/en](https://velarium.cc/en)   |
|  23 | [https://vidapi.ru/](https://vidapi.ru/)                                                           |  200 | Same address                                       |
|  24 | [https://www.viduki.net/](https://www.viduki.net/)                                                 |  200 | Same address                                       |
|  25 | [https://vidcore.net/](https://vidcore.net/)                                                       |  200 | [https://vidcore.io/](https://vidcore.io/)         |
|  26 | [https://www.vidcore.org/](https://www.vidcore.org/)                                               |  200 | Same address                                       |
|  27 | [https://vidfast.vc/](https://vidfast.vc/)                                                         |  200 | Same address                                       |
|  28 | [https://vidfast.xyz/](https://vidfast.xyz/)                                                       |  200 | [https://vidfast.vc/](https://vidfast.vc/)         |
|  29 | [https://vidfast.pm/](https://vidfast.pm/)                                                         |  200 | [https://vidfast.vc/](https://vidfast.vc/)         |
|  30 | [https://vidfast.net/](https://vidfast.net/)                                                       |  200 | [https://vidfast.vc/](https://vidfast.vc/)         |
|  31 | [https://vidfast.me/](https://vidfast.me/)                                                         |  200 | [https://vidfast.vc/](https://vidfast.vc/)         |
|  32 | [https://vidfast.io/](https://vidfast.io/)                                                         |  200 | [https://vidfast.vc/](https://vidfast.vc/)         |
|  33 | [https://vidfast.in/](https://vidfast.in/)                                                         |  200 | [https://vidfast.vc/](https://vidfast.vc/)         |
|  34 | [https://vidflix.club/](https://vidflix.club/)                                                     |  200 | Same address                                       |
|  35 | [https://vidlink.pro/](https://vidlink.pro/)                                                       |  200 | Same address                                       |
|  36 | [https://vidhawk.buzz/](https://vidhawk.buzz/)                                                     |  200 | Same address                                       |
|  37 | [https://vidnest.fun/](https://vidnest.fun/)                                                       |  200 | Same address                                       |
|  38 | [https://vidrock.net/](https://vidrock.net/)                                                       |  200 | Same address                                       |
|  39 | [https://vidrift.net](https://vidrift.net)                                                         |  200 | Same address                                       |
|  40 | [https://vixsrc.to/](https://vixsrc.to/)                                                           |  200 | Same address                                       |
|  41 | [https://vidsrc.sh](https://vidsrc.sh)                                                             |  200 | Same address                                       |
|  42 | [https://vidsrc2.ru](https://vidsrc2.ru)                                                           |  200 | Same address                                       |
|  43 | [https://vidsrc.ir](https://vidsrc.ir)                                                             |  200 | Same address                                       |
|  44 | [https://vsembed.ru/](https://vsembed.ru/)                                                         |  200 | Same address                                       |
|  45 | [https://vsembed.su/](https://vsembed.su/)                                                         |  200 | Same address                                       |
|  46 | [https://vidsrc.domains/](https://vidsrc.domains/)                                                 |  200 | Same address                                       |
|  47 | [https://vidsrc.to/](https://vidsrc.to/)                                                           |  200 | Same address                                       |
|  48 | [https://vidup.to/](https://vidup.to/)                                                             |  200 | Same address                                       |
|  49 | [https://www.vidy.st/](https://www.vidy.st/)                                                       |  200 | Same address                                       |
|  50 | [https://vidzee.wtf/](https://vidzee.wtf/)                                                         |  200 | Same address                                       |
|  51 | [https://vidzen.fun/](https://vidzen.fun/)                                                         |  200 | Same address                                       |
|  52 | [https://vyla.cc/](https://vyla.cc/)                                                               |  200 | Same address                                       |
|  53 | [https://zoryva.me/embed](https://zoryva.me/embed)                                                 |  200 | Same address                                       |
|  54 | [https://github.com/mohameodo/nano](https://github.com/mohameodo/nano)                             |  200 | Same address                                       |
|  55 | [https://github.com/xp-technologies-dev/p-stream](https://github.com/xp-technologies-dev/p-stream) |  200 | Same address                                       |
|  56 | [https://theintrodb.org/](https://theintrodb.org/)                                                 |  200 | Same address                                       |
|  57 | [https://github.com/TheIntroDB](https://github.com/TheIntroDB)                                     |  200 | Same address                                       |
|  58 | [https://skipdb.tv/](https://skipdb.tv/)                                                           |  200 | Same address                                       |
|  59 | [https://sub.wyzie.ru/](https://sub.wyzie.ru/)                                                     |  200 | [https://sub.wyzie.io/](https://sub.wyzie.io/)     |
|  60 | [https://libre-subs.fifthwit.net/](https://libre-subs.fifthwit.net/)                               |  403 | Same address                                       |
|  61 | [https://www.npmjs.com/package/wyzie-lib](https://www.npmjs.com/package/wyzie-lib)                 |  403 | Same address                                       |
|  62 | [https://docs.wyzie.ru/](https://docs.wyzie.ru/)                                                   |  200 | [https://docs.wyzie.io/](https://docs.wyzie.io/)   |
|  63 | [https://www.themoviedb.org/](https://www.themoviedb.org/)                                         |  403 | Same address                                       |
|  64 | [https://rentry.co/FMHYB64#tiff](https://rentry.co/FMHYB64#tiff)                                   |  200 | Same address                                       |
|  65 | [https://anicore.dpdns.org/](https://anicore.dpdns.org/)                                           |  200 | Same address                                       |
|  66 | [https://anikura.club/api](https://anikura.club/api)                                               |  200 | Same address                                       |
