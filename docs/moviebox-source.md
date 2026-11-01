# Native MovieBox integration

Implemented 2026-11-01 on `moviebox-native-extension`. The extension lives in
`extensions/moviebox`, independently of the app routes, player and optional
compatibility imports. It uses native SDK 1.4.

## Observed protocol

The catalogue's public guest bootstrap is `GET /wefeed-h5api-bff/country-code` on
`h5-api.aoneroom.com`. It issues an extension-owned guest token in `X-User`.
Search needs that session; sending the web client's timestamp header directly
to search returned an invalid-token error. Guest tokens remain in isolate memory.

Search uses `POST /subject/search`. Source-owned collections use
`POST /subject/filter`, with channel 1 for Movies and 2 for TV. Observed sort IDs
are Hottest and Latest. Filtering the mixed trending feed locally produced empty
movie pages and was replaced with these actual per-kind feeds.

Details use `/detail?detailPath=…`. Season listings contain `maxEp` and `allEp`;
the latter can explicitly omit an unavailable episode. Repeated search rows for
different seasons share one subject ID. IDs remain strings, duplicates combine,
and the original release year is retained.

The normal Watch Online flow publishes the player domain through
`/media-player/get-domain`. The observed player origin is `mzfi.me`. Play requests
must include the full title player URL as Referer. Requests to the catalogue
origin or with a bare-origin Referer returned no streams despite successful HTTP
responses. The extension uses the observed player request, preserves restriction
mode, and only returns explicitly unlocked MP4/HLS renditions.

Caption lookup is once per stream resolution, using the best accessible rendition
ID. Caption failures do not prevent video playback. Tracks needing a nonzero
delay are omitted because the current subtitle contract has no per-track offset.

## Boundary change

Native sources previously could not send any Authorization/Referer headers.
SDK 1.4 introduces the separately reviewed `network:session` permission alongside
`network`. A small allowlist covers extension-owned API session/source headers;
Cookie and Host remain blocked. Header values are bounded, reject control
characters, and cannot disable the source VIP-restriction header. Existing exact
host grants, DNS/address guards, redirect refusal, request bounds and deadlines
remain in force. No ambient browser accounts or cookies are exposed.

## Evidence and scope

Primary observations came from the [public catalogue](https://h5.inmoviebox.com/)
and its shipped web assets, not a copied CloudStream provider. The
reverse-engineer-anything skill was used for bounded static JavaScript analysis
and controlled headless browser scenarios. Static graph coverage was partial;
it does not establish that all application code was examined or executed.

| Asset                   | SHA-256                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `Ou_T2PQJ.js`           | `f3c6269f7fc2f7a8abec34248bf359bd4cc14ae27259ba1b1cb05c6f37c7a41a` |
| `player-id.660dae58.js` | `04e2502bade17ebc19b075f5bdebaa9ef9a3ceb7648347165ccf12db4b83ef64` |
| `Ckto9Wtc.js`           | `b2810bf8bc37694b335f3eedc0f8c5757898644e97682e25bec315745995700f` |

Retained REA records: static parent
`ev_577ec4803493fe46cbfa236351145aa2a8cdb87b749cdd50c3440a010f67bb9b`,
search `ev_b6dc6dbd40840a00edc86bff928fd8087612d6250ab54c79bcfa88e5a6a52749`,
and natural player
`ev_183f6535092ed68409c41c1dfd5a33081f898b984d974f50c1846cc54388a677`.
One header capture hit the concurrent-read budget; a separate temporary headless
browser observed the needed non-credential request headers. No user browser
profile, stored account or login was used.

## Verification

- 147 extension-host tests pass, including eight MovieBox isolate/broker cases
  and two added session-boundary cases. Extension-host and Nova type checks pass.
- Nova Electron/renderer production build passes.
- Astro builds 17 routes; 411 local links/anchors and docs UI checks pass.
- Explicit live checks use the production extension in QuickJS, the real
  permission broker and Nova's guarded transport. Popular and Latest each return
  24 titles for both media kinds.
- Sherlock: 12 available entries, 360p/480p guest streams and nine subtitle tracks;
  search-to-stream resolution 1,448 ms. The 4 KB MP4 sample arrived in 392 ms.
- Night of the Living Dead (1968): one feature, 480p and 13 subtitle tracks;
  resolution 1,171 ms. Its 4 KB sample arrived in 58 ms.

These are point-in-time observations. See the sanitized
[live report](moviebox-live-report.json). They do not prove sustained playback,
all-title coverage or a playback speed multiplier. Premium-locked 1080p was
excluded; account/premium login and DASH are not implemented. No extension was
installed into the user's profile and no installer was generated.

Next candidates are KissKH for Asian dramas and Pinoymoviepedia for Filipino
content, as described by the user-supplied catalogue. They remain separate future
integrations, not working entries in this release.
