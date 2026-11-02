# StreamFlix Movies native port — experimental

Offers Popular and Latest additions, title search, cover art and configured direct MP4/MKV mirrors. No TMDb key, account or extra server is needed for this source's catalogue. Metadata is cached for five minutes, pagination is bounded, duplicates are removed and unsupported/malformed rows are excluded.

The public catalogue/config returned JSON during investigation (5,408 rows; approximately 3.84 MB). **Playback is currently unavailable on the tested mirrors:** `bb.streamflixserver.site` failed DNS resolution and seven sampled Wasabi movie objects returned 404 on 2026-11-02. The port is fixture-tested; native playback is not certified. Catalogue availability is not movie availability.

This release intentionally declares **Movies only**. The public Firebase REST TV endpoint returned 401, so no fabricated season/episode URLs or unauthorized fallback is provided. The original provider's fixed 1080p/720p guesses are replaced by `auto`; mirror names do not establish actual resolution.

Only exact known configured mirror bases are accepted. Upstream config cannot add arbitrary hosts. File paths reject traversal and are encoded segment by segment. Latest means latest catalogue additions, not release year.


The native manifest and card are included in **Extensions → Available**, but installation is held. Large catalogue responses also reproduce an existing QuickJS teardown assertion; that requires a separate runtime fix before enabling this source. The normal memory/transport limits have not been raised. Bundled sources appear even without a registry URL. Use the existing permission review; nothing is installed automatically. The native source runs in Vestra's QuickJS sandbox and uses brokered network requests. No Nuvio runtime, Node `require`, external dependencies or copied TMDb key is needed.

This is an independent Vestra implementation of the observed public endpoint contracts, informed by [Yoru's Nuvio provider repository](https://github.com/yoruix/nuvio-providers). Original provider listings remain third-party evidence, not a compatibility guarantee. No upstream provider module is executed by Vestra.

Run `pnpm test:provider-ports` for fixtures/offline installer checks and `pnpm test:provider-ports:live` for current public API diagnostics. Fixtures establish implementation behavior; they do not certify upstream availability.
