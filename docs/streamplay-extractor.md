# Streamplay embed extraction

Updated: 2026-10-30.

The installed DonghuaStream script throws “No scraper implemented” when a server
option contains a Streamplay iframe. The C# adapter now recognizes that exact
failure for `https://play.streamplay.co.in/embed/<id>` and invokes a narrow host-side
media extractor, then returns the normal validated stream result. The original
installed provider code and its guest network grants are not rewritten.

The extractor follows the player protocol observed in shipped site assets:

1. Fetch the supported embed through the existing public HTTPS transport.
2. Decode its literal packed dictionary and read `apx`, `qsx` and `kaken` assignments.
   No page JavaScript, advertisements or third-party player scripts are evaluated.
3. Fetch the same-origin `/pl/<id>` configuration and decode the observed CryptoJS
   AES JSON format using the public `_decx` protocol value from app-v3.2.js.
4. POST the episode token to the configuration's public HTTPS video API and map its
   sources/tracks to HLS/MP4 quality choices and caption metadata.

Input/expansion limits, endpoint/identity checks, cancellation, a bounded attempt
budget, guarded public-address transport and existing stream-result schemas apply.
Raw embed HTML, encrypted configuration, episode tokens and video URLs stay in main.
Unsupported formats, damaged crypto and missing/upstream-empty configuration produce
specific errors; the advertised-mirror resolver can continue to another server.
This is a transport/player compatibility implementation, not DRM or account access.

## Evidence and limits

The reverse-engineer-anything skill was used with REA for the shipped JavaScript
artifacts and a temporary headless Edge observation. REA statically parsed both
scripts; its graph was partial because the scripts are obfuscated, and it does not
prove arbitrary dynamic behavior. The owned browser observed a GET to `/pl/<id>`
and was terminated with its temporary profile. Static string-table recovery and
inspection established the `_decx` algorithm and the later source POST shape;
that later POST was not observed live because configuration was unavailable.

Observed asset SHA256 values:

- app-v3.2.js: `ea8ce98a95bca5c9ac92cf61b2f17f29f778b799e7819fda5facf77647f2dd2b`
- player-v4.4.6.min.js: `2c5cd6528c8477694d053d0d6b7a94270e48833bf4e29d792b7a35f20261b827`

The reported embed and two current DonghuaStream embed IDs returned HTTP 200 with
an empty configuration body during checks. The live extractor therefore reports
upstream-unavailable. No live Streamplay video playback pass is claimed. An empty
configuration cannot be turned into a video URL by changing mpv or inventing a
stream. Existing mirrors remain available through normal fallback.

Three fixture cases cover inert dictionary decoding, bounded inputs, the observed
AES JSON protocol against an independent OpenSSL vector, POST data, HLS/MP4 and subtitle mapping, wrong hosts, endpoint
substitution, damaged ciphertext, explicit unavailable state and cancellation.
`pnpm test:streamplay:live` records current upstream availability separately from
the deterministic protocol tests. A site protocol/key change will need a new
captured fixture and compatibility update.
