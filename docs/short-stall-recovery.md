# Repeated buffering repair — Nova 0.1.1

The preceding live AnimeGG sample paused five times for a total of 8.21 seconds
in one minute. None of these short pauses reached the existing twelve-second
continuous-stall deadline, so the player could repeatedly stop/start without
trying recovery.

## Behavior

Automatic playback now enters the existing recovery path after at least three
genuine cache pauses totaling six seconds within a rolling sixty-second window.
It still tries untried mirrors with HD preference before its bounded final
lighter-rendition attempt. A single continuous stall retains the twelve-second
guard. Native error handling is unchanged.

The tracker ignores sub-250 ms pauses and intervals where the playhead advances
by at least half a second. Seeking, explicit pause, loading a different file and
disposing the player reset the history. Explicit quality selections never enter
the new recurring-stall path. Startup buffering is excluded from that path.

A confirmed recurring-stall recovery may complete after the original stream
briefly resumes, since this is the stop/start behavior being repaired. It reloads
at the then-current position. Pause/resume, seek, natural completion, replacement and disposal revoke
the pending attempt, so a late result cannot overwrite those user actions. A
stale failed attempt also cannot show an error over a newer operation.

The final rendition choice now compares against the actual playing URL before
choosing a lighter rendition. Previously, a source initially selected at 720p
could select 720p again even if 480p was offered. When no lighter rendition
exists, the existing bounded final HLS bandwidth-budget attempt remains; the
player cannot manufacture missing qualities.

## Startup investigation

The benchmark now supports `--provider`, `--compare`, `--candidate-first`,
`--probe-info` and `--pause-wait`. Comparison mode resolves a source once and
opens the same stream with baseline and candidate profiles in separate hidden
native processes. These options are experimental benchmark controls, not app
settings. The app's defaults remain unchanged.

An AnimeGG Naruto episode 220 comparison yielded:

| Profile | First native-ready | Pauses in 60 seconds | Paused time |
| --- | --- | --- | --- |
| Existing `auto` probing, 1-second refill target | 19.83 s | 0 | 0 s |
| `nostreams` probing, 4-second refill target | 10.66 s | 1 | 1.49 s |

This was a sequential network observation with a warmed second request and two
changed controls, not evidence that either option improves playback. Startup
varied substantially across runs. The selected stream was MP4: mpv 0.41 already
marks that format for skipping additional stream-info analysis in automatic
mode. See the [mpv source](https://github.com/mpv-player/mpv/blob/v0.41.0/demux/demux_lavf.c)
and [option reference](https://mpv.io/manual/stable/#options-demuxer-lavf-probe-info).
The refill option changes how much media must accumulate before resuming; it
does not increase source throughput ([reference](https://mpv.io/manual/stable/#options-cache-pause-wait)).

Neither experimental setting is enabled in the app. Native first-picture
latency remains an open source-delivery investigation; no startup speedup or
stall-free live result is claimed by this repair.

## Validation

Controlled playback fixtures cover the recurring threshold, HD mirror reload,
preserved position, manual choices, seek/pause resets, expiry (including partial overlap at the window boundary), advancing stale
cache flags and pending recovery after resume. They also verify cancellation
after a quick pause/resume or seek, and an actually lower final rendition when
initial playback was already 720p. Existing service, quality, loader and hidden
native HLS/header/subtitle checks remain applicable.

The live comparison above measures the two experimental native profiles without
app recovery. It is not a live verification of the new recurring-stall policy;
that policy is verified with controlled session events and recovery fixtures.

## Windows release receipt

- App source: `e0cbd56` (Nova 0.1.1).
- Installer: `apps/nova/release/Vestra Nova Setup 0.1.1.exe` (167,185,932 bytes).
- SHA-256: `CD858119A21E8D042AD93E3C55F60FD6C8CF44CB2961DCB715CE08557A70A092`.
- Typecheck and production build passed; all 21 buffering/recovery fixtures,
  anime service/quality, loader controls and hidden native HLS checks passed.
- The packaged version, main process, preload and renderer entry match the final
  build. Packaged worker tests passed with SDK tools hidden, including TypeScript,
  persistence and cancellation recovery.

The previous 0.1.0 installer is retained. The new installer was built and checked,
not automatically installed over the user's running app.
