# Playback and installer validation — 2026-11-01

The completed extension platform, manga SDK, installer UI and playback scheduling
work was merged to `main` at `561183d` before packaging.

## Windows build

- Artifact: `apps/nova/release/Vestra Nova Setup 0.1.0.exe`
- Size: 167,185,359 bytes.
- SHA-256: `B30116140E86A4808C42CE84925D684AB70D42387760808CDBE1D353A81BACC4`
- Built with `pnpm --filter @vestra/nova package`, including the self-contained
  C# worker, TypeScript compiler, renderer and bundled mpv.
- `test-packaged-worker.mjs --resources apps/nova/release/win-unpacked/resources`
  passed: worker selection, bundled compiler, TypeScript execution, manga
  progress, provider calls, cancellation recovery and SDK-hidden execution.

The installer was built, not installed over the user's running application.
This does not replace a clean-machine install/uninstall check.

## Repeatable live playback measurement

```powershell
pnpm benchmark:anime --samples 3 --seconds 60 --worker apps/nova/release/win-unpacked/resources/server/Vestra.Server.exe
```

The script uses enabled anime compatibility providers from the local managed
source configuration without modifying that configuration or the user's store.
Each sample uses isolated temporary provider data. It measures search, episode
listing, extraction/manifest validation, native first-ready time, observed
resolution, playhead advancement and native cache pauses. JSON output defaults
to `.tools/playback-benchmark/report.json`; signed stream URLs and headers are
excluded. `--output`, `--query`, `--samples`, `--seconds` and `--worker` allow
repeatable follow-up runs.

Native playback uses the application's HD-first selection and cache profile,
8 Mbps HLS master selection budget, hidden/null video output and disabled audio.
Each observation lasts 60 seconds after native playback readiness, with a
30-second startup deadline. The probe deliberately does not switch mirrors
during playback, so results expose the selected server's behavior rather than
concealing it with automatic recovery. Resolution comes from decoded video
parameters, not an advertised quality label.

This isolates source delivery and decoding; it does not measure GPU rendering,
audio synchronization or perceived stutter in the actual desktop player. A
successful minute is a sample, not a guarantee of uninterrupted full episodes.
Packaging/compression finished before the live measurement started.

## Observed results

Three 60-second samples completed using the packaged C# worker:

| Source / sample | Decoded resolution | Native first-ready | Cache pauses | Paused time | Playhead advance |
| --- | --- | --- | --- | --- | --- |
| DonghuaStream — Renegade Immortal Movie 2, episode 1, Server 2 | 2560×1066 | 11.04 s | 0 | 0 s | 60.08 s |
| AnimeGG — Naruto, episode 220, GG-SUB | 960×720 | 15.25 s | 5 | 8.21 s | 51.84 s |
| Shonen — Naruto, episode 1, Sub | 1056×800 | 5.77 s | 1 | 0.82 s | 59.27 s |

Search / episode listing / extraction times respectively were 1.25 / 0.47 / 1.71
seconds for DonghuaStream, 2.05 / 2.62 / 3.12 for AnimeGG, and 1.85 / 0.36 / 1.47
for Shonen. Native first-ready is measured after URL resolution, not from the
initial search click. Worker startup and provider loading are also separate
from these stage timings. These are different titles/episodes, not a controlled
comparison of providers serving identical media.

DonghuaStream sustained its sample without a cache pause. AnimeGG still needs
attention: its repeated short pauses demonstrate a remaining delivery problem
even though no individual pause reached the current long-stall recovery deadline.
Shonen had one brief pause. Advertised quality labels were `auto`, `720p` and
`Auto`; the table uses actual decoded dimensions instead.

The immediate follow-up is to investigate native startup request latency and
repeated short-stall handling, keeping explicit quality choices and HD-first
mirror recovery intact. No before/after speed multiplier is established by this
run. A zero benchmark exit code means observations completed, not that playback
was stall-free. Raw local measurements are in `.tools/playback-benchmark/report.json`.
