# Future endeavours

Things Vestra should do, deliberately not built yet. Each entry says what it
needs and why it was deferred, so picking one up does not start from scratch.

---

## Anime4K upscaling

Real-time upscaling for anime, run as GLSL shaders inside mpv. It is the single
biggest visible quality win available for the kind of content this app is for,
particularly on 720p and older 1080p releases.

**What it needs**

- The Anime4K shader files (MIT licensed, ~100 KB) fetched alongside mpv by
  `apps/nova/scripts/fetch-mpv.mjs` and shipped in `extraResources`.
- A `glsl-shaders` property set on the mpv session, plus a way to clear it.
- Preset tiers rather than a single toggle. Anime4K ships several chains
  (Mode A/B/C, and "fast" variants); the right one depends on the source
  resolution and the GPU. A single switch would be wrong half the time.
- A GPU cost warning. The heavier chains are demanding, and silently dropping
  frames is worse than not offering the feature.

**Why deferred:** it is a real feature with shader assets, presets and
performance implications, not a toggle. Shipping a switch that did nothing
would have been worse than shipping nothing.

---

## Player appearance and preferences shortcuts

The settings menu in the player is playback-scoped. Broader options — theme,
accent, library folders — live in the Settings route. Shortcuts from the player
menu into that route would save a trip, but they are navigation rather than
new capability.

---

## Rewatch handling for skip times

Skip intervals come from AniSkip and are cached per episode for the life of the
process. Auto-skip fires once per range so that seeking back into an opening is
not immediately undone. What is missing:

- Remembering skips across sessions, so a rewatch does not re-offer them.
- A way to report a wrong timing back to AniSkip.

---

## Chapters as a skip source

`media-probe.ts` already extracts chapters and derives opening/ending ranges
from their titles. No release tested so far carries chapters, so the path is
dead code in practice — but it is correct, costs nothing, and would be the
better source when present because it comes from the file itself.

Worth wiring into the same merge as AniSkip results, preferring chapters where
both exist.

---

## Downloads

`packages/types` already models download settings, and qBittorrent is the
intended client. Nothing is wired: no IPC channels, no UI. This is a whole
subsystem rather than a feature, and it needs its own security review — a
torrent client is a network service running next to the app.

---

## Extension installation UI

`packages/extension-host` is complete and tested: sandboxed QuickJS isolates,
content-addressed installs, hash verification on every read, brokered network
access. What is missing is the surface for installing one — a browse, review
and grant flow. The permission model exists; nothing asks the user to approve
it yet.

---

## `packages/ui` and `apps/pulse`

`packages/ui` is orphaned — it was shared between the deleted web app and Nova,
and Nova now has its own components. It should either be deleted or become the
real shared component library.

`apps/pulse` is an empty Expo scaffold. It should not grow until there is an
API contract for it to consume.

---

## Second engine verification

The built-in `<video>` path exists for anything Chromium can decode, but every
file in the test library is HEVC, so mpv handles all of it. The fallback path
has therefore had very little real use. Worth testing deliberately with an
H.264/AAC MP4 before trusting it.
