# Nuvio provider adaptation review

Reviewed 2026-11-02. Includes the first native ports. Fixture verification and live availability are reported separately.

## Native port implementation update

Implemented **DesiFlix Movies/Series**, **StreamFlix Movies** and **Vidlink Movies/Series** as independent native Vestra sources. Each has its own manifest, sandbox entry point, bounded validation and tests. Existing **VixSrc** also appears in the bundled catalogue. This does not port every source in the upstream repositories.

Nova now lists seven shipped source cards (MovieBox, KissKH, Internet Archive, VixSrc, StreamFlix, Vidlink and DesiFlix) without requiring a remote registry or folder picker. Remote registries remain supported; matching IDs are deduplicated. The installer resolves bundled IDs through a fixed allowlist, rebuilds the manifest review and uses the existing fingerprinted install/storage path. Packaged apps copy the same source resources. New sources are optional and never auto-installed.

StreamFlix and Vidlink are labelled **experimental / upstream unavailable**. StreamFlix installation is held; Vidlink has a warning before installation. Current evidence:

- DesiFlix is a native port from the CB repository using public IMDb metadata and direct JSON stream responses. Movie (`tt0111161`) and TV (`tt0903747:1:1`) passed actual native playback: HEVC video, AAC/AC3 audio, embedded subtitle tracks, 2 seconds advanced for each. Public top-catalogue endpoints were unavailable, so it offers title search without falsely advertising a Popular feed.

- StreamFlix catalogue/config are readable (5,408 entries; about 3.84 MB). TV Firebase requests return 401; the port declares Movies only. Two early and five recent/popular movie objects on Wasabi returned 404, and the configured alternative mirror failed DNS. No fixed-quality guesses or fabricated TV links were retained. A full-sized catalogue also reproduces a QuickJS teardown assertion, so installation is explicitly blocked pending runtime repair. This did not reproduce with the smaller DesiFlix metadata responses. The global runtime memory and network limits remain unchanged.
- Vidlink's public helper returned 403 before any playback API response. The independent resolver supports known JSON response shapes, keeps HLS masters intact and accepts explicit MP4/MKV files. It stops at the HTTP error without challenge execution.
- Fixture checks cover discovery pagination/cache, exact episode mapping, unsafe links, master/subtitle preservation and server exclusion. They are not live playback certification.
- The native stream contract now labels MKV directly. MP4 and HLS remain supported. No source should relabel MKV as MP4.

The earlier source-review table below records initial findings. This update supersedes its planning-only state for these three ports; remaining candidates are unported. Follow [StreamFlix README](../extensions/streamflix/README.md) and [Vidlink README](../extensions/vidlink/README.md) for current limitations.

## Compatibility

These are Nuvio repositories, not Vestra registries. Yoru uses a `scrapers` array; CB uses a `providers` array. Entries reference JavaScript `getStreams(tmdbId, mediaType, season, episode)` modules. Vestra expects a validated manifest, explicit permissions/host grants and sandboxed source methods. Pasting these repository manifests into the installer is not supported.

All manifest entries are inventoried below. Only StreamFlix, CinemaCity, Vidlink, Vidnest (Yoru) and PlayIMDb (CB) received source-level inspection in this pass. No upstream JavaScript was executed, no bundled third-party credentials were used or copied, and no source was installed. The rest remain manifest-only candidates, not verified APIs. Format and enabled flags are upstream claims.

## Candidate findings and order

| Candidate | Source evidence | Decision |
| --- | --- | --- |
| MovieBox / VixSrc | Already overlap with Vestra sources. | Maintain existing implementations; do not add duplicate cards. |
| StreamFlix | JSON config and catalogue at `api.streamflix.app`; source uses a Firebase WebSocket resolver, Cheerio and TMDb metadata. Both JSON endpoints returned 200 with JSON; catalogue probe read only 2 KB. | First candidate for deeper investigation. Prove a bounded HTTP resolver before choosing a native port. Current network broker does not offer WebSocket; catalogue success alone proves no playback. |
| CinemaCity | Cheerio HTML search and base64 player configuration, not a JSON content API. Title fallback selects the first result, which risks wrong-title playback. Root returned 403. | Hold: fails the API-first preference and live access gate. |
| Vidlink | Calls external `enc-dec.app` service to encode TMDb ID, then `/api/b/movie` or `/api/b/tv` on `vidlink.pro`. | Investigate dependency/API stability first; no playback verification yet. |
| Vidnest | Source calls an external AES-GCM decryption service and proxy, with several media origins. | Hold pending a bounded local crypto design and exact domain inventory; no remote helper dependency copied. |
| PlayIMDb | CB source contains obfuscated logic, `streamdata.vaplayer.ru/api.php` and another settings wrapper. | Hold pending source trace, response contract and native stream verification. No claims that an advertised direct link works. |
| Other entries | Manifest metadata only. | Review actual source and docs before prioritizing. Iframe-only flows remain excluded. |

Primary source files:

- [StreamFlix](https://github.com/yoruix/nuvio-providers/blob/main/providers/streamflix.js)
- [CinemaCity](https://github.com/yoruix/nuvio-providers/blob/main/providers/cinemacity.js)
- [Vidlink](https://github.com/yoruix/nuvio-providers/blob/main/providers/vidlink.js)
- [Vidnest](https://github.com/yoruix/nuvio-providers/blob/main/providers/vidnest.js)
- [PlayIMDb](https://github.com/SA7ANI/cb-providers/blob/main/providers/playimdb.js)

License endpoint checks were inconclusive; verify upstream permissions/attribution before copying code. A new Vestra implementation can reuse the existing host-owned TMDb catalogue and receive title/year/IDs as hints; it must never receive the user's TMDb credential.

## Implementation gate

1. Document actual HTTP API requests/responses and any official docs; identify authentication, redirects, media hosts and dependencies.
2. Prove movie and TV episode matching plus native MP4/HLS playback, subtitles and failure behavior. Do not treat HTML or an embed URL as playable media.
3. Implement only the smallest candidate that passes, with bounded response sizes, cancellation, strict host grants and no website-script execution.
4. Add fixture tests and a real native-player probe. Bundled sources ship with the app; remote registry releases must use immutable code URLs. Unverified ports must be clearly experimental with their known failures shown before installation; do not mark them verified.

## yoruix/nuvio-providers: 29 entries

[Manifest](https://raw.githubusercontent.com/yoruix/nuvio-providers/main/manifest.json)

| Provider | Enabled | Advertised media | Advertised formats |
| --- | --- | --- | --- |
| 4KHDHub | True | movie, tv | mkv |
| AnimePahe | True | movie, tv | m3u8 |
| UHDMovies | True | movie, tv | mkv |
| MoviesMod | True | movie, tv | mkv |
| DahmerMovies | True | movie, tv | mkv |
| NetMirror | True | movie, tv | unspecified |
| StreamFlix | True | movie, tv | mkv |
| MovieBox | True | movie, tv | mp4, mpd |
| Vixsrc | True | movie, tv | unspecified |
| DVDPlay | True | movie, tv | mkv |
| YFlix | True | movie, tv | m3u8, mp4 |
| VIDEASY | False | movie, tv | m3u8, mp4, mkv |
| MalluMV | True | movie | mkv, mp4 |
| Vidlink | True | movie, tv | m3u8, mp4 |
| Vidnest | True | movie, tv | mp4, m3u8 |
| VidnestAnime | True | movie, tv | m3u8 |
| Cinevibe | True | movie | mp4, m3u8 |
| CinemaCity | True | movie, tv | mp4 |
| Castle | True | movie, tv | mp4, m3u8 |
| ShowBox | True | movie, tv | mp4, mkv |
| HDHub4u | True | movie, tv | mkv, mp4 |
| AllMovieLand | True | movie, tv | m3u8 |
| DooFlix | True | movie, tv | m3u8 |
| MovieBlast | True | movie, tv | mp4, mkv |
| MyCima | True | movie, tv | mp4, m3u8 |
| MoviesDrive | True | movie, tv | mkv, mp4 |
| HiAnime | True | movie, tv | m3u8 |
| Kurage | True | movie, tv | mp4 |
| AniZone | True | movie, tv | m3u8 |

## SA7ANI/cb-providers: 28 entries

[Manifest](https://raw.githubusercontent.com/SA7ANI/cb-providers/main/manifest.json)

| Provider | Enabled | Advertised media | Advertised formats |
| --- | --- | --- | --- |
| MoviesDrive | True | movie, tv | mp4, m3u8 |
| 4KHDHub | True | movie, tv | mp4, m3u8 |
| HDHub4u | True | movie, tv | mp4, m3u8 |
| VegaMovies | True | movie, tv | mp4, m3u8 |
| Castle | True | movie, tv | mp4, m3u8 |
| RedFlix | True | movie, tv | mp4, m3u8 |
| Kurage | True | anime, movie, tv | mp4, m3u8 |
| AniZone | True | anime, movie, tv | mp4, m3u8 |
| DesiFlix | True | movie, tv | mp4, m3u8 |
| Dahmermovies | True | movie | mp4, m3u8 |
| Dahmermovies-TV | True | tv | mp4, m3u8 |
| MovieBox | True | movie, tv | mp4, m3u8 |
| MoviesMod | True | movie, tv | mp4, m3u8 |
| Movix VF | True | movie, tv | mp4, m3u8 |
| PlayIMDb | True | movie, tv | mp4, m3u8 |
| TopCartoons | True | anime, tv | mp4, m3u8 |
| Torrentio | True | movie, tv | mp4, m3u8 |
| VidRock | True | movie, tv | mp4, m3u8 |
| Reanime | True | anime, movie, tv | mp4, m3u8 |
| AnimeWorld | True | anime, movie, tv | mp4, m3u8 |
| AnimeSalt | True | anime, movie, tv | mp4, m3u8 |
| AniZen | True | anime, movie, tv | m3u8 |
| NetMirror | True | movie, tv | m3u8 |
| AniKage | True | movie, tv | m3u8 |
| MultiMovies | True | movie, tv | m3u8, mp4 |
| ToonStream | True | movie, tv | m3u8, mp4 |
| PureToons | True | movie, tv | m3u8, mp4 |
| Einthusan | True | movie | mp4 |
