# Provider runtime implementation and live status

## Verification

`pnpm test:server` covers 46 runtime cases when the three optional source paths
documented in apps/server/README.md are supplied. `pnpm test:server:compat` builds
the worker and checks TypeScript diagnostics, a real AnimeAV1 TypeScript provider
(load and settings, not network behavior), SHA256/SHA1/MD5, AES against independent
Node crypto vectors, IV-prefixed and legacy OpenSSL salted decryption, random-byte
generation, worker restart persistence and cross-provider isolation.

## TypeScript

Nova transpiles `.ts` global Provider scripts using the existing TypeScript
compiler before sending JavaScript to C#. Compilation never imports or executes
provider code in Node. Syntax diagnostics and module/import rejection are tested.
This performs syntax transformation, not semantic type-checking. The C# worker
continues to accept JavaScript only. Packaged deployment remains a separate task;
the existing preview configuration is development-only.

## Crypto

Original C# bindings use System.Security.Cryptography. Supported APIs:
CryptoJS.enc Utf8/Base64/Hex/Latin1/Utf16/Utf16LE, AES.encrypt/decrypt with CBC and
PKCS7, SHA256, SHA1, MD5, and crypto.getRandomValues for Uint8Array. CryptoJS-like
word arrays cross the boundary as base64 JSON strings and return no CLR objects.

AES matches Seanime's observed convention: a string key is raw UTF-8, hashed with
SHA256 unless 16/24/32 bytes. Without a supplied IV, encryption prepends a random
16-byte IV. Decryption accepts that layout or legacy `Salted__`/MD5 derivation.
This is not full CryptoJS password-encryption interoperability: encryption does
not emit the OpenSSL salted envelope. Invalid padding, invalid IVs and unsupported
modes fail explicitly. General WebCrypto/subtle, HMAC, GCM and CryptoJS.lib are
not implemented. WordArray default output follows Seanime's base64 convention.

## Persistence

`$store` supports get/set/delete/clear/length with JSON values. Values persist
under Nova's user-data/data/csharp-provider-store folder, partitioned by a SHA256
of provider ID. Atomic file replacement follows a flushed temporary write. A
failed quota write leaves previous data intact; corrupt data fails visibly and
is not silently overwritten. Limits: 256 keys/provider, 512-character keys,
256 KiB/operation, 1 MiB/provider file. Missing keys return undefined; stored null
remains null. The storage directory has one worker owner; multiprocess concurrent
writes are unsupported. No general library/account database migration is included.

The standalone worker is memory-only unless VESTRA_PROVIDER_DATA_DIR is set.
Unloading an extension does not delete its store. The configured provider source
and preferences still come from the preview JSON configuration, not a new GUI
installer or automatic source updater.

## Live probes

`pnpm check:providers:live` repeats one bounded catalogue-relevant search, episode lookup and
stream URL resolution for each of three explicitly selected providers. It never
downloads or plays the resulting media. Host grants remain enforced. The report
omits resolved media URLs/credentials and records source hashes in
[live-provider-report.json](live-provider-report.json).

Earlier observations (superseded by the current results below):

| Provider           | Result                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| AniDB              | Search redirect to https://anilab.so:443 rejected by the existing explicit grant; direct redirect probe confirmed an HTTP 302 |
| AnimeSaturn mirror | Explicit nested-player profile: 10 search results, one episode, one stream and an HLS manifest returning HTTP 200             |
| DonghuaStream      | Search request completes but the provider parser returns No anime found                                                       |

The original AnimeSaturn extractor failed because its player page is now an
iframe wrapper. The explicit animesaturn-nested-player-v1 profile follows a
bounded iframe chain and extracts a static primary HLS URL. It does not execute
page scripts or add network grants. The example grants the observed embed host
cdn2.megaplay.su explicitly. Fixture checks cover relative URLs, header preservation
and cycle rejection. Source hashes in the report refer to original files; the
profile name identifies the applied override. AniDB and DonghuaStream still need
provider maintenance. No successful live-provider playback or speedup is claimed. Browser automation,
full provider parity, GUI deployment, library persistence and the remaining Seanime
subsystems are still outstanding.

## Current catalogue and mirror results

The current DonghuaStream script has changed since the earlier hash. A Battle
query returns six titles and three episodes. Server 1 resolves a URL whose
manifest responds HTTP 403; advertised Server 2 returns HTTP 200 and valid HLS.
The preview now supports preferredServer and selects Server 2 for this source.
A configured server must appear in the provider settings or resolution fails
visibly. Normal playback does not probe all mirrors before starting.

The live diagnostic checks up to two additional mirrors after a manifest failure,
records the query and source hash, and separates resolved URLs from verified HLS.
Each manifest check is scoped to the returned media host and retains public-IP
and redirect checks; it never expands installed provider grants.

AniDB's original source is now missing from the reference tree. The diagnostic
records source-missing and continues; it does not recreate or replace that file.
Direct inspection of anilab.so found an app landing page, not the old catalogue
interface. The retained installed Nova extension was left unchanged.

AnimeSaturn remains verified through HLS metadata. No actual live playback or
performance improvement is claimed for either source.
