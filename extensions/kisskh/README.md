# KissKH for Vestra

Native SDK 1.4 Movies/TV extension. Install `extensions/kisskh` through
**Extensions → Choose extension folder**, review its hosts/source-header
permission, and choose KissKH in Movies or Series. Nothing is auto-installed.

Includes source-owned Popular, Latest, Ongoing and Upcoming feeds, typed search,
available episodes, direct MP4/HLS and plain SRT/VTT subtitles. Requests use the
same public key format as the observed web client. It needs no browser session,
account login, remote decryption service or additional runtime dependency.

Source IDs stay stable, fractional episodes remain distinct, and missing season
numbers are not invented. The site's `releaseDate` can describe upload time, so
it is not presented as the original release year. Video type follows the API:
some URLs ending in `.mp4` actually serve HLS. Quality stays `auto` because the
API does not label a resolution; this extension does not promise HD.

Iframe-only sources are reported as unavailable rather than mislabeled as
video. Encrypted `.txt` subtitle tracks are not offered. A caption outage does
not prevent otherwise playable video. Hosts, client version and key format can
change and require a source update; no challenge solving is included.

## Development

Edit `src/source.js` and `src/request-key.js`, then rebuild the standalone entry:

```powershell
pnpm build:extension:kisskh
pnpm test:kisskh
```

`index.js` is the generated, committed install payload. Native isolates do not
resolve source imports. The request-key calculation is independent code using
standard AES-128-CBC; deterministic tests compare it to Node crypto and observed
client vectors.

Opt-in live verification uses the actual isolate, broker and guarded HTTP and
reads bounded media samples without installing anything:

```powershell
pnpm test:kisskh:live
```

Live checks passed for Goblin episode 1 and Train to Busan, including actual media
signatures and subtitle text. See [the report](https://github.com/amabee/Vestra/blob/main/docs/kisskh-source.md).
Sustained playback and all-title coverage still need personal testing.
