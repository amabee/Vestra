# Vidlink native port — experimental

Supports Movies and Series through Vestra's host-owned TMDb catalogue. Add your own TMDb credential in Settings. Only canonical title/season/episode IDs cross into the extension; credentials stay in the host.

The source calls the public ID-encoding helper at `enc-dec.app` then the Vidlink JSON API. The helper returned **403** in this environment on 2026-11-02. The port is implemented and fixture-tested, but native playback has **not** passed live verification. Try another source while the helper is unavailable. No browser challenge is executed or bypassed.

Preserves HLS masters and associated audio/subtitles, handles explicit MP4/MKV sources, skips embed-only responses and unsafe media URLs, and reports quality only when provided by the API. No guessed media links or recursive URL harvesting. Season zero and exact episode identities are preserved. Source exclusion prevents retries against the same server.


Install from **Extensions → Available** in a rebuilt Nova. Bundled sources appear even without a registry URL. Use the existing permission review; nothing is installed automatically. The native source runs in Vestra's QuickJS sandbox and uses brokered network requests. No Nuvio runtime, Node `require`, external dependencies or copied TMDb key is needed.

This is an independent Vestra implementation of the observed public endpoint contracts, informed by [Yoru's Nuvio provider repository](https://github.com/yoruix/nuvio-providers). Original provider listings remain third-party evidence, not a compatibility guarantee. No upstream provider module is executed by Vestra.

Run `pnpm test:provider-ports` for fixtures/offline installer checks and `pnpm test:provider-ports:live` for current public API diagnostics. Fixtures establish implementation behavior; they do not certify upstream availability.
