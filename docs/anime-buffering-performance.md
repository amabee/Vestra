# Streaming buffering policy

Nova 0.1.1 also handles repeated short cache pauses that never reach the
continuous-stall deadline: in Auto, at least three genuine pauses totaling six
seconds in sixty seconds trigger the existing HD-first recovery path. See the
[short-stall repair](short-stall-recovery.md) for cancellation rules, final
rendition selection and the inconclusive startup-profile experiment.

## Loading and UI overhead (2026-11-01)

Manifest probes and Streamplay extractor HTTP requests now pass cancellation to
the guarded transport. Previously they only checked the signal between requests;
losing mirrors could keep downloading until their individual timeout. The HTTP
helper now races the entire DNS/fetch/body operation against cancellation and its
deadline, cancels retry waits, and does not start HTTP after cancelled DNS finishes.
Actual DNS resolution itself cannot be interrupted; its late result is ignored.

Progress and cache telemetry sent to both player renderers is coalesced on a
100 ms interval. Loading readiness, buffering transitions, pause, tracks, errors
and other controls still publish immediately. The native playback/recovery state
is updated at its original frequency. A fixture sending 100 telemetry changes
publishes one initial state and one latest state after 100 ms, reducing redundant
IPC copies and React updates without adding delay to the first-ready event.

The HD-first quality policy and native cache profile below are unchanged. These
changes reduce abandoned network work and UI update churn; they do not increase
CDN bandwidth or establish a live playback speed multiplier.

Verification includes DNS/body cancellation without retries, probe signal
forwarding, telemetry coalescing with immediate control events, existing mirror,
HD/recovery and OP/ED fixtures, Streamplay protocol fixtures, hidden native HLS
decoding with headers/subtitles, Nova typecheck and production builds.

## Cache and quality policy

The reported failure was long startup followed by repeated stalls lasting roughly two minutes. This change addresses application-controlled waits and excessive default bandwidth; it does not establish the throughput of the user's CDN or claim a measured 2–3× live improvement.

## Changes

- Automatic quality prefers the highest numbered rendition at or below 1080p. If none exists, it uses the lowest numbered rendition; unlabelled streams retain their source ordering. Explicit quality selections stay exact, and the player exposes an **Auto (HD first)** option.
- Automatic HLS master selection uses an 8 Mbps bandwidth budget instead of mpv's default highest bitrate. This is a selection budget, not a guaranteed throughput cap or continuous adaptive bitrate algorithm.
- After twelve seconds of sustained cache starvation while playing, automatic mode first tries untried mirrors with the Full HD preference, preserving position. After at most three mirror switches, it makes one final attempt at or below 720p with a 3 Mbps HLS master budget. Native delivery errors begin recovery immediately. See [mirror failover](anime-mirror-failover.md). If the source has no lower rendition, these limits cannot manufacture one.
- A persistent stall after recovery is exhausted, or a persistent stall on manually selected quality, stops with an actionable error. Pause, replacement, stop and process exit cancel pending recovery. Recovery does not repeat indefinitely.
- mpv uses an explicit application-owned profile: network timeout 8 seconds, network read-ahead target 120 seconds, forward cache limited to 256 MiB and backward cache to 32 MiB. Playback does not wait for this cache to fill at startup. Local files do not force network caching. Network timeout applies to individual operations; it is not a guaranteed end-to-end startup deadline.
- C# provider startup validates the Full HD manifest first and starts once a usable rendition is found. Other advertised qualities remain selectable without delaying startup to probe them all. Failed candidates are removed; unknown qualities can still fail when explicitly selected.

The option semantics were checked against the installed mpv executable's `--list-options` and [mpv 0.41's official option documentation](https://github.com/mpv-player/mpv/blob/v0.41.0/DOCS/man/options.rst). Automatic playback prioritizes Full HD and uses HD for stall recovery. Explicit qualities remain available in player settings.

## Verification

- `test-stream-buffering.mjs`: automatic/manual selection, cache/timeout policy, HLS option reset between loads, position-preserving lower-rendition recovery, bounded recovery, pause handling and first-usable manifest probing.
- `test-remote-playback.mjs` with `VESTRA_TEST_MPV` pointing at the bundled executable: actual hidden native HLS decoding with the new profile and bandwidth option, external subtitle/header preservation and option resets. The local transport fixture is not a live-CDN speed benchmark.
- Anime service, server fallback, loading overlay, TypeScript checks and production build.

Rebuild/restart the app to load the new native process policy. An already-running mpv process retains its previous startup options.
