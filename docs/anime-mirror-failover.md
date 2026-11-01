# Automatic mirror failover

Automatic playback now tries another advertised mirror of the same episode after a sustained stall or a native delivery/decoder error. A genuine stall still requires twelve seconds without meaningful playhead progress. Native errors start recovery immediately.

Recovery prefers Full HD on each untried mirror before making a final lighter-quality attempt on the last usable mirror. It permits at most three mirror switches, then one lighter attempt; it cannot cycle indefinitely. Each native reload preserves the current playback position and uses the new mirror's headers and subtitles. A mirror that has no Full HD rendition can supply its best available rendition under the HD-first policy.

## Integration

- The provider interface accepts an optional `excludeServers` argument on stream resolution. Existing initial calls remain one-argument guest calls.
- The C# adapter skips excluded advertised server IDs. The chosen ID is authoritative even when a guest returns a generic display name. Extraction and manifest validation still use the existing guarded paths.
- The shared source-episode registration helper keeps initial resolution and recovery attached to the same provider and episode ID. Anime details and catalogue adapters reuse it.
- Startup races advertised mirrors and returns the first validated result immediately. It cancels unfinished extraction and manifest probes instead of waiting three seconds to gather backups. Recovery resolves untried mirrors on demand. The C# worker serializes guest calls, so starting these promises together does not provide parallel JavaScript execution. Cancelling an active guest call stops that worker; the existing session replays loaded providers before its next operation.
- Providers returning several server groups can recover from their existing results. Providers ignoring exclusion hints are filtered by returned server identity; if no untried mirror exists, recovery proceeds to its final lighter attempt.
- Mirror history and rendition candidates belong to one playback recovery plan. They neither alter the selected library provider nor rewrite shared manual quality handles.
- Manual quality selections remain explicit and do not silently switch mirrors. Pause, close or replacement playback suppress stale recovery results; a late failure cannot publish an error over another episode.

## Verification and limits

Deterministic regression fixtures cover mirror exclusion through the provider boundary, stable episode/progress identity, HD preference, headers/subtitles, same-position native reload, immediate native-error recovery, finite retry budgets, cache expiry during recovery, provider removal and stale results after episode replacement. Existing service, quality, subtitle, loader and server-fallback checks remain applicable.

This does not establish a live speed multiplier or guarantee that another mirror is available. It does not switch to another provider, infer episode matches across providers, download video segments into a new proxy, or introduce a browser adaptive-HLS engine. Signed URLs and upstream server availability can still fail; exhausted recovery retains actionable playback errors.


## Startup optimization check (2026-11-01)

Removed the fixed three-second backup collection window. Headers, subtitles and HD rendition selection still follow the existing validation and playback paths. Cancellation now reaches guest extraction, Streamplay extraction and manifest probes; late results cannot start a new probe after completion. Failed mirrors still fall back, and the aggregate deadline cancels unfinished work.

A hidden live check using the installed DonghuaStream extension resolved a title, loaded three episodes, validated an HLS manifest and decoded one frame with bundled mpv. Search took 1,065 ms, episode listing 1,037 ms, settings 7 ms, and mirror extraction plus manifest validation 2,187 ms. This is one upstream sample, not a benchmark of all providers or sustained playback. Repeated episode-list caching and worker isolation remain separate follow-up work.

Verification: Nova typecheck and production build; anime service, stream-buffering and mirror fixtures; live installed-provider manifest and hidden native frame decode. Mirror fixtures cover immediate first success, cancellation, deadline cancellation during probing, late result suppression, failed-mirror fallback and recovery exclusions.
