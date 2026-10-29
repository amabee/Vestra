# Stream quality selection

Episode cards and stream rows now have a **Quality** menu. Opening it resolves the
provider's advertised renditions on demand. Choosing one starts/resumes that
episode with that rendition. Normal Play keeps the provider's first playable
rendition. Refresh qualities re-queries a changing source.

Main retains all stream URLs and per-rendition headers/subtitles. The renderer gets
only opaque locators and bounded labels (quality, server and container). Up to 50
renditions are offered. Source/server/quality/container identity is independent of
signed URL query strings, so opening a chosen rendition resolves fresh URLs again.
If that quality disappears, playback reports it rather than silently switching.
Duplicate identical labels use their provider occurrence order for disambiguation.

The queue keeps its original episode locators; rendition overrides are separate
player state, preserving queue and progress identity. Explicit resume positions
are retained. Other episodes keep their default quality unless individually
selected, and opening another title clears overrides.

This selects provider-advertised renditions before playback; it does not parse an
HLS master into additional choices or implement seamless mid-playback switching.
The source's configured server remains authoritative for C# providers.

Verification: the player-state test checks queue identity, resume and override
reset. Playback helper tests check lazy choices, hidden URLs, signed URL refresh,
quality selection after reordering, rendition headers and unavailable choices.
Type checks and Electron/renderer builds pass. The native mpv fixture was not rerun
and interactive picker/playback verification is deferred; installer refresh is
also pending.

Subtitle titles, languages and default selection are now preserved by the native
loading path; see [subtitle-metadata.md](subtitle-metadata.md) for behavior and the
remaining actual-playback verification gate.
