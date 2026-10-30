# Anime playback repair

The working-tree performance and quality changes were reviewed against the previous streaming implementation. The updated details layout and in-player quality control remain in place.

## Correctness

- Search caches store provider data, not short-lived renderer handles. Each search issues current handles, and replacement provider instances get separate caches.
- Cached stream/quality lookups still validate the provider registration and enabled state. Extraction is shared across concurrent requests; a native media failure invalidates its cached signed URLs before retry.
- Quality requests must belong to the current episode. A response arriving after navigation cannot reopen an older episode.
- Native load clears old chapters and exposes loading and cache-buffering state. Opening/ending controls remain suppressed until the current playback has opened; errors and retry controls are rendered above native video.
- Skip-time caches and renderer query keys include runtime. Invalid, negative, out-of-runtime and clearly incompatible reported runtimes are rejected. Temporary API errors are not permanently cached. Missing submissions expire and can be retried.
- AniSkip still requires a known AniList identity mapped to MyAnimeList and a real positive integer episode number. Unknown provider-only catalogue identities or unnumbered specials do not receive guessed intervals. Embedded release chapters remain preferred when available.

## Startup work

- Details checks for owned files and official links exclude streaming adapters, avoiding duplicate source searches/episode requests beside the selected provider query.
- Removed automatic extraction of episode one on every details load. Focus/hover on an episode play button warms that episode. Near the end of playback, the next episode warms after a short delay, keeping short-lived URLs fresh for the transition. Unrelated episodes are not downloaded.
- Quality inspection and playback share a short-lived resolver result, including in-flight work.
- Safe GET retries retain the caller's total timeout budget, including DNS checks and backoff. POST requests are never replayed.
- The animated loader appears both beneath native video during initial resolution and in the transparent controls window during media loading/buffering. It respects reduced-motion settings and displays no fabricated percentage.

These remove redundant work and excess waits; source availability and network/CDN throughput still determine live startup time. No fixed speedup or successful playback on unavailable mirrors is claimed.

## Verification

Run from the repository root:

```powershell
pnpm --filter @vestra/nova typecheck
pnpm --filter @vestra/nova build
node apps/nova/scripts/test-anime-service.mjs
node apps/nova/scripts/test-playback-repair.mjs
node apps/nova/scripts/test-player-loading-ui.mjs
node apps/nova/scripts/test-anime-ui.mjs
node apps/nova/scripts/test-player-quality.mjs
node apps/nova/scripts/test-anime-servers.mjs
```

UI fixtures use hidden/offscreen Electron windows and isolated temporary profiles. Network tests use deterministic transport fixtures; they do not assert live OP/ED coverage for every anime or a live playback performance benchmark.
