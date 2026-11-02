# API-only source follow-up

The user narrowed new candidates to APIs rather than iframe-only services, and
explicitly allowed an optional self-hosted service. VixSrc remains implemented;
the earlier directory audit is historical research, not a release list.

## Updated disposition

- PrimeSRC: public info JSON works. Static inspection of the public client found
  `/api/v1/s` (server keys) and `/api/v1/l` (link resolution). Six sampled server
  resolutions returned 403. A repeat with the normal Referer returned a managed
  browser challenge. Hold playback integration; no challenge execution/bypass.
  The client contains Turnstile handling and consumes a returned `link`, but that
  does not prove the link is direct media. TV numbering is TVMaze-based according
  to the public docs, another mapping requirement before future integration.
- Vyla: primary docs reconfirm `/movie` and `/tv` SSE with playable candidates,
  `meta` subtitle events and `done`. It has no public hosted streaming API.
  Proceed as an optional host-owned service connector, disabled by default.
- 2embed metadata JSON is not a streaming API. Exclude from this playback track.
- Other iframe-only entries remain excluded. Do not relabel an embed route as a
  media API or create install cards for unverified services.

## Connector plan, before implementation

1. Keep the sandbox unchanged. A host-owned connector gets one explicitly
   configured service URL; extensions do not gain arbitrary local-network access.
2. Permit exact loopback HTTP for a locally operated service and public HTTPS
   for remote deployments. Reject URL credentials, queries/fragments and
   redirects. Reuse public-host validation for remote addresses.
3. Reuse host-owned TMDb metadata/season handling and the current source registry,
   details, queue and native player. No second library or credential bridge.
4. Consume SSE incrementally with bounded bytes/events/time, cancellation and
   immediate first usable source. Do not wait for every provider. On mirror
   recovery, request again while excluding attempted source keys.
5. Accept only verified HTTPS HLS/MP4 media. Local service HTTP proxy media is
   outside the existing player contract: use direct HTTPS upstreams or a public
   HTTPS media proxy. No general HTTP-stream exception.
6. Use subtitles already delivered with `meta`, without blocking on a separate
   subtitle API. Keep signed media separate from catalogue caches.
7. Test split SSE frames, early playback/cancellation, format validation,
   malformed/empty/error responses, URL restrictions and mirror exclusion.
   Real deployment playback remains an explicit live gate; fixture tests cannot
   certify the user's future service or its upstreams.

## Implementation status

- Added the disabled-by-default host connector in `vyla-service.ts`, registered
  only when `VESTRA_VYLA_URL` is set. Optional bearer auth is host-owned.
- Reused catalogue matching/season normalization and the native source adapter.
  Generalized adapter IDs to retain stable IDs for host services as well as
  existing extensions.
- Added incremental SSE parsing, early usable-source return, bounded media
  inspection, cancellation, mirror exclusion and sanitized transport errors.
- Setup and delivery restrictions: [Vyla service guide](website/vyla.md).
- No Vyla service was deployed, no user profile modified and no registry entry
  published. Real upstream playback remains unverified until a service is supplied.
- Verification: nine connector tests passed, including real loopback SSE,
  fragmented events, immediate return/cancellation, media-format rejection,
  mirror exclusion, deadlines and host-owned catalogue/season reuse. Nova
  typecheck and production build passed, as did 24 Movies/TV service checks and
  two remote-playback checks (the optional mpv fixture was not enabled in that
  run). Docs navigation/source files were checked; the previously recorded Astro
  dependency-import build stall was not resolved as part of this connector.

## No-server follow-up

Vyla setup commands are saved in the root README for later use. New public API
candidates must return actual media without a separately operated service or a
new account/key. The user approved both a classics source and continued research
for mainstream Movies/TV.

- AnyPlay's primary API docs explicitly return `embed_urls` and HTML iframe
  playback. Excluded from the native API track.
- ezvidapi homepage and the indexed Consumet-alternative page returned 404.
  Its indexed direct-HLS claims are not evidence of a currently usable API.
- Syln documents required credentials on browse and play, and plan quotas.
  It is not an account-free installation. A direct docs request timed out here.
- NHD's JSON API documentation describes required API keys; the direct docs
  request was unreachable here. Not a no-setup candidate.
- Internet Archive: public search and metadata APIs responded without credentials.
  Scope is the `feature_films` collection, not a promise of mainstream releases.
  `his_girl_friday` metadata exposes public MP4 derivatives, explicit heights,
  durations and an SRT caption. A different sample was dark/restricted and must
  be refused, even when metadata returns HTTP 200.

### Internet Archive implementation gates

1. Verify a public MP4 in bundled mpv before treating the source as functional.
2. Add a Movies-only native extension with exact archive.org host permission.
   Reuse its own metadata; no TMDb credential is required for this catalogue.
3. Keep search and Popular/Latest bounded and paginated, with cached metadata and
   no extraction burst while browsing. Search text must remain literal.
4. Refuse dark/restricted items, private files, unsafe names and preview clips.
   Preserve archive item IDs, reported quality and file-specific captions.
5. Keep each archive item as one feature entry; do not invent seasons or combine
   multi-part editions. Validate fixtures and a bounded native playback sample.
6. Provide local folder installation docs. Publish no registry entry until a
   release is pinned. Continue mainstream research separately; no qualifying
   additional mainstream API has been demonstrated in this follow-up yet.

Primary references: [AnyPlay API](https://anyplay.stream/api),
[Syln API docs](https://syln.dev/docs), [NHD API docs](https://nhdapi.com/docs),
[Archive metadata](https://archive.org/developers/md-read.html),
[Archive advanced search](https://archive.org/advancedsearch.php),
[His Girl Friday metadata](https://archive.org/metadata/his_girl_friday).

### Implemented and verified

Added `extensions/internet-archive` as a Movies-only native extension. Nine
QuickJS/broker fixture tests passed, as did extension-host typecheck. Live checks
verified literal title search, 14 records on each of two Popular pages, seven
Latest additions, and the selected feature's 480p/240p alternatives. Bundled mpv
advanced through two seconds of H.264/AAC playback and loaded an external SRT
caption. Reports stay under ignored `.tools/archive-source/`. No profile install
was performed.

Registry follow-up: Internet Archive is now published in the Vestra Available
list. Manifest/code URLs are pinned to payload commit
`ebf291131649421c71838111be6b476eb9eead48`; registry commit `e2fa149` was pushed
to main through isolated branch `nova-publish-archive-extension`. The remotely
served registry, manifest and payload passed an in-memory prepare/complete
installation check using main's SDK 1.4.0, including exact source hash, requested
network permission and archive.org host. The existing user profile was not
modified. Other pending Nova/VixSrc/Vyla work was not part of that release.

Visibility fix: the user's existing Nova profiles contained only third-party
registries, so publishing the Vestra feed did not subscribe the app to it.
The Vestra registry was appended to both existing profiles after creating local
settings backups, preserving their custom lists. New profiles now default to
the Vestra registry; explicit saved lists remain respected. Available also has
a Refresh button. Default/custom/empty settings checks, Nova typecheck and the
production build passed.

The existing hidden mpv probe was extracted into `native-media-probe.mjs` for
reuse by VixSrc and Archive checks; this does not change production playback.
Vyla remains disabled until configured. No additional mainstream source passed
the no-account/no-server native-media gate in this follow-up.

## Earlier PrimeSRC/Vyla research evidence

Primary documentation: [PrimeSRC](https://primesrc.me/),
[Vyla playback](https://vyla.cc/stream-api/reference/paths.md),
[Vyla hosting](https://vyla.cc/stream-api/deployment/self-hosting.md),
[Vyla subtitles](https://vyla.cc/stream-api/reference/media-data.md).

Public client `primesrc.js` SHA-256:
`f1362bdc814b54482f8c585f4b22b2edf72776caa4293d6b9cc79ecf8c0a138a`.
REA parent evidence:
`ev_8b918b37800a858ea21d2f31f98651f4b6ec3f03b4ba780c7b44cd978240fdb6`.
Its semantic analysis exhausted the worker heap; coverage is partial. Endpoint
strings and surrounding consumers were also inspected as inert text, and API
responses checked independently. No downloaded scripts were executed. Raw
responses remain in ignored `.tools/primesrc-api/`; keys/challenge tokens are
not release artifacts.
