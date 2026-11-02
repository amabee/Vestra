# VixSrc native source — implementation record

Implemented on branch `vixsrc-native-source`. Local folder installation is ready;
registry publication remains pending a pinned release. Existing MovieBox and
KissKH integrations keep their own catalogue paths.

## Evidence and request flow

The selected public movie client was read as an inert artifact using the
reverse-engineering skill. Its SHA-256 was
`a57d7d8695b55832161c0bda1ec2b62c658506bf58403157456969183864ce83`.
REA static parent evidence:
`ev_e52dfd29308ac0cb3f3e03aa5151e60bcfda98a56b3e703d10b533d00bd8da65`.
Controlled clean-profile Edge network capture:
`ev_6f7c3357d4658c25d0a11158813c33d6de7c2dcf38dbfbb3010a53628d470a1f`.
Static coverage was partial; browser capture observed the public delivery chain,
not every player action. Downloaded scripts are never evaluated in the app.

Observed delivery from [VixSrc](https://vixsrc.to/):

1. `/api/list/movie/` or `/api/list/tv/` returns title availability IDs. The
   trailing slash matters: the slashless route redirected to HTTP during research.
   The integration requests HTTPS directly and retains Vestra's redirect guard.
2. `/api/movie/<tmdbId>` or `/api/tv/<tmdbId>/<season>/<episode>` returns a
   short-lived relative embed address. Consume immediately; do not cache it.
3. The embed HTML exposes public `masterPlaylist.url` and token/expiry parameters.
   Parse only the expected literal configuration; no script evaluation.
4. Fetch that signed playlist with `h=1&lang=en` and
   `Referer: https://vixsrc.to/`. Require an actual HLS master before returning it.
5. mpv follows rendition, audio and subtitle playlists to changing media hosts.
   The sandbox only fetches the declared VixSrc host for this extraction.

Raw signed URLs/configurations remain ignored in `.tools/vixsrc-research/`;
they are not fixtures or release artifacts. No challenge solving, account flow
or DRM processing was added.

## Host-owned catalogue

The public index contains IDs, not searchable names, artwork or season metadata.
SDK 1.5 adds optional `catalogueSource: "tmdb"` to Movies/TV stream sources.
It requires a current host, network permission and a declared TMDb API hostname.

`catalogue-stream-source.ts` reuses Vestra's TMDb client. The host filters metadata
through the guest's `matchCatalogue(candidateIds)` export, validates the returned
subset, and hydrates artwork/details itself. Credentials never enter the guest.
No third-party public metadata proxy or new dependency was added.

TV metadata is fetched with at most two concurrent season requests and filtered
to known air dates through today. `getEpisodes(titleId, hints)` receives canonical
episode hints; the host rejects foreign titles, duplicate IDs or altered episode
identity. It does not fetch the source's unfiltered all-episode dump.

Source index cache: 15 minutes with single-flight loading. Host Popular pages:
15 minutes, 128-entry bound. Logical UI pages slice fixed 20-record upstream
pages before availability filtering, preserving records when the UI requests 14.
Search/browse never resolve every title's media. Signed playback addresses are
kept separate from catalogue cache.

## Verification and limits

- Deterministic tests run in real QuickJS with broker fixtures: canonical IDs,
  index cache, season/special identity, malformed/foreign embeds, expiry retry,
  non-HLS rejection and manifest constraints.
- Host tests cover ID-only messages, host-owned metadata, 14/20 pagination,
  aired episode filtering, cancellation and forged episode rejection.
- Live checks verify movie TMDb 278, TV 1396 S1E1 and S5E1, HLS rendition lists,
  a bounded media segment, English WebVTT and an unavailable episode error.
- Bundled mpv advanced at least two seconds in each of those three samples,
  decoded H.264/AAC, and exposed 17, 8 and 7 subtitle tracks respectively.
  Extraction took 3,365 ms, 1,977 ms and 904 ms in that run. These are extraction
  timings, not measured first-frame times or a sustained throughput guarantee.
- Live TMDb account-backed search is not certified by direct-ID source probes;
  it requires the user's configured host credential. Host integration is covered
  with deterministic metadata fixtures.

Run `pnpm test:vixsrc`, `pnpm test:screen` and
`pnpm test:vixsrc:live --mpv`. Sanitized live results are saved locally as
`.tools/vixsrc-live-report.json`. No user profile is modified by these checks.

Long playback, seeking, resume, next episode and actual expiry during playback
remain manual release checks. No claim is made that all titles or regions work.

Nova production build, Nova/extension-host typechecks, 164 extension-host tests,
24 Movies/TV service tests, installer checks and the hidden Movies/TV UI regression
passed. Docs navigation/source validation passed. The full Astro docs build
stalled before content rendering; a standalone import of the existing
`@astrojs/markdown-remark` dependency also stalled. That build is not certified
by this implementation pass.
