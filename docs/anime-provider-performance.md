# Anime provider isolation and episode metadata cache

Anime sources now use a bounded pool of provider-specific C# sessions. Previously, searches, episode listing, stream extraction, manga commands and provider downloads all shared one serialized session. A slow guest call could delay unrelated sources, and cancelling it stopped the shared worker.

## Worker lifecycle

- Each resident anime provider owns a session. Calls for that provider remain serialized, preserving guest state and avoiding concurrent writes to its provider store.
- Up to four anime sessions are resident. Additional requests wait for capacity; idle sessions are evicted in order of last use. The request queue is bounded to 64 waiting jobs.
- Workers are also released after 60 seconds idle. Definitions remain registered; the next request reloads the provider. Failed sessions retain the existing replay behavior without retrying an interrupted operation.
- Cancellation of a queued request removes it promptly. Cancelling an active operation can stop that provider's worker without stopping other providers. Disable/update removes the definition, stops its session, rejects queued work and prevents late results from being accepted.
- Manga, reading progress, bookmarks and artifact downloads retain their existing session. Anime sessions reuse the existing provider store directory and provider IDs. Store files are already scoped by the hash of each provider ID, so this preserves saved data without migration or concurrent sessions for the same anime provider.

The pool permits concurrency across providers, not parallel JavaScript execution within one provider. When all four workers are busy, another provider still waits for a slot. Each worker has startup/method deadlines, and callers retain their existing cancellation deadlines.

## Episode cache

- Cache raw episode metadata for five minutes, scoped to one provider activation. Updating or re-enabling a source creates a new cache.
- Keep up to eight title lists, with at most 2,000 episodes per list. Failed, empty and cancelled fetches are not cached.
- Concurrent callers for one title share a fetch. Cancelling one caller leaves other callers running; cancelling the last caller cancels the underlying request.
- Return copies, and reuse opaque handles for unchanged episode metadata. Repeated cached listing no longer fills the 5,000-entry handle map with duplicates and evicts episodes from an existing queue. Changed metadata gets a new handle; prior handles remain usable until normal bounded eviction.
- Playback URLs, signed streams and extracted mirrors are not added to this metadata cache. Existing stream expiry and HD selection remain in force. New episodes can take up to five minutes to appear in a previously cached title.

## Verification

`pnpm test:anime:runtime` runs cache and scheduling fixtures plus real hidden C# sessions. Coverage includes isolation, per-provider serialization, capacity, queued cancellation, disable/re-enable, idle release, shutdown, failed activation, cache coalescing, independent caller cancellation, retry, expiry, bounded storage, handle reuse and store persistence after worker eviction.

Nova typecheck and full production build passed, along with anime service, mirror fallback, source lifecycle and existing C# worker tests. The installed-provider live test now uses the same pool and episode-cache classes as production.

On 2026-11-01, DonghuaStream search took 6,817 ms, initial episode listing 498 ms, repeat cached listing rounded to 0 ms, settings 5 ms, and the winning mirror was validated after 5,119 ms. One mirror failed and the next worked. Bundled mpv decoded a frame using the extracted stream and headers with hidden/null output. This is one live sample; upstream timing varied from the prior run. It does not establish sustained HD throughput or a speed multiplier.

Restart the development app to load the new main process code. The production bundles were rebuilt; an installed packaged executable needs repackaging separately.
