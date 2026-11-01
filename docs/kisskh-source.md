# Native KissKH source

Implemented 2026-11-01 on `kisskh-native-extension`, stacked on Movies/TV support
and MovieBox. Runtime source is `extensions/kisskh/index.js`, bundled from the
two small files in `src`; no dependencies were added.

## Observed interface

The [public site](https://kisskh.co/) exposes typed search and lists under
`/api/DramaList`. The shipped Explore client maps TVSeries to type 1, Movie to
type 2, Popular to order 1 and Last Update to order 2. Status 1 is Ongoing;
status 3 is Upcoming. These source-owned filters drive the extension's feeds and
real pagination, rather than filtering unrelated catalogue results.

Details supply actual episode IDs and fractional labels but no reliable season
number. The source's `releaseDate` for Goblin was an upload-era date, so it is
omitted as a release year. The extension retains exact IDs, rejects foreign
episodes, sorts episode labels and caches title metadata for one minute.

The shipped public client computes separate video/subtitle request keys with a
checksum and AES-128-CBC. The extension implements that calculation independently
in plain JavaScript. Tests compare both observed vectors with Node's independent
crypto implementation; no remote decryption endpoint or browser profile is used.

Playback's Type flag matters: Type 1 is HLS even when Video ends in `.mp4`;
Type 0 is direct MP4 and Type 2 is an embed. Only direct video is offered, with
the correct SDK type/format label. Resolution is not supplied, so quality remains
Auto. The existing player handles playback. Plain SRT/VTT tracks are retained;
encrypted `.txt` captions are omitted, and subtitle errors do not block video.

## Evidence

The reverse-engineer-anything skill was used for selected inert JavaScript
analysis and a declared headless browser scenario on the public episode page.
Static analysis was limited to common/scripts and did not establish full-app
coverage. Additional selected route modules were inspected as inert source.

| Shipped asset             | SHA-256                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| `common.js`               | `cffbf97c8caa4e2663dc800c50fb19a7459d4f74bfa215789160371b996aad27` |
| `502.33bac7b53e9897b8.js` | `85b3dba9a8bf81abd48cbdd7d6d44e33a418c57830acac7f53f2c0211660d501` |
| `780.f011ddf6618b7a1e.js` | `f7be56bd271453a388ea072226c2df2bbcd8fdb94c00dbbe323ef4d9258c3585` |

REA static parent:
`ev_de9f0c6b9246ffd1a3bb9f1ed2db29a51a6829ae1ee9fd1aaa74cd268f1eb381`.
Controlled browser observation:
`ev_5498db23d4802b43f24e0985ded17fe2029033fff847284984ec6c5068e74aa4`.
No user browser session, private account or installed profile was used.

## Verification

Extension-host suite: 157 passing cases; extension-host/Nova type checks and the
Nova production build pass. Three hidden Movies/TV UI groups and four installer
cases pass. Astro builds 18 routes; 455 local links/anchors and docs UI checks
pass. The final payload also passes the targeted KissKH cases after strict ID
validation was tightened.

Ten deterministic KissKH cases run the committed payload in real QuickJS with
the permission broker. They cover typed search, collections, pagination,
fractional/duplicate IDs, detail caching, both request-key vectors, disguised HLS,
captions, subtitle outages and rejection of invalid/foreign/embed inputs.

The shared live harness now serves MovieBox and KissKH through the same actual
isolate, broker and guarded HTTP stack. Both live checks pass after that refactor.

See the sanitized [KissKH live report](kisskh-live-report.json):

- Popular/Latest/Ongoing/Upcoming were queried for Movies and TV. Upcoming Movies
  returned an honest empty page; other tested collections returned results.
- Goblin episode 1: 17 available entries including episode 13.5, MP4 signature,
  six subtitle tracks and verified plain caption text. Resolution took 1,121 ms;
  its 4 KB MP4 sample arrived in 320 ms.
- Train to Busan: one feature, HLS signature despite its `.mp4` URL, six tracks
  and verified caption text. Resolution took 1,143 ms; a bounded playlist sample
  arrived in 223 ms.

These are point-in-time transport observations, not sustained playback or an HD
guarantee. No source was installed into the user's profile and no installer was
generated. Website/client changes may require an updated extension and host
review. Pinoymoviepedia remains a future candidate.
