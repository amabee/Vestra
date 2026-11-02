# DesiFlix native Movies/Series source

Install **DesiFlix** from **Extensions → Available** in a rebuilt Nova. No folder picker, API key, account or additional server is required. Nothing is installed automatically.

Search uses public Cinemeta IMDb metadata; playback uses DesiFlix's JSON stream API. Choose Movies or Series and search for a title. This release does not advertise a Popular feed: the tested public Cinemeta top-catalogue endpoints were unavailable. Metadata search can return a title that DesiFlix cannot play; availability is checked on Play.

The source uses exact IMDb identities, aired season/episode metadata (including season zero), five-minute bounded metadata caches and fresh playback links. Only explicit HTTPS HLS, MP4 or MKV files are returned. Torrents and embeds are excluded. Quality comes from source filename/title metadata when present, otherwise Auto. Audio languages vary, often Hindi or dual audio; use the native player's audio-track selector. Subtitles embedded in MKV remain available through the native player.

## Verification

`pnpm test:desiflix:live --mpv` exercises the real QuickJS runtime, granted network broker and native player without installing into a profile. On 2026-11-02:

- The Shawshank Redemption (`tt0111161`): 3 mirrors, HEVC video, AAC audio, 3 subtitle tracks, playback advanced 2 seconds.
- Breaking Bad S1E1 (`tt0903747:1:1`): 3 mirrors, HEVC video, AC3 audio, 1 subtitle track, playback advanced 2 seconds. The metadata catalogue exposed 67 aired entries including specials; not every entry is guaranteed playable.

These samples prove native playback for those entries, not every title or uninterrupted full-length playback. `pnpm test:provider-ports` covers source fixtures and offline bundled installation.

## Implementation sources

Independent Vestra implementation informed by [CB's provider listing](https://github.com/SA7ANI/cb-providers/blob/main/manifest.json) and [DesiFlix adapter](https://github.com/SA7ANI/cb-providers/blob/main/providers/desiflix.js). No upstream JavaScript or embedded API key is executed/copied. Public API contracts:

- `https://manifest.desitvhub.eu.org/manifest.json`
- `/stream/movie/<imdb-id>.json` and `/stream/series/<imdb-id>:<season>:<episode>.json`
- `https://v3-cinemeta.strem.io/catalog/<movie|series>/top/search=<query>.json`
- `/meta/<movie|series>/<imdb-id>.json`

The network grant covers the API/metadata endpoints only. The native playback path validates returned public media URLs separately; no broad wildcard network grant is added.
