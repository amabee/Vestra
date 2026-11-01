# Anime Home, Schedule and Discover

Implemented 2026-11-01, preserving Vestra's existing typography and palette.

## Experience

- Home groups Continue Watching, Currently Watching, Plan to Watch, Completed,
  On Hold and Dropped from existing local lists, history and playback progress.
  Named playlists remain accessible alongside those shelves.
- Schedule shows broadcasts for saved anime with Week begins, list status and
  Show watched episodes controls. Dates use local calendar arithmetic, including
  daylight-saving changes. Unmatched titles and result limits are disclosed.
- Discover adds a featured title, horizontal carousels, search and dropdown genre,
  release year, release status, season and format filters. Feeds include trending,
  seasonal top titles, coming soon and anime movies.
- All three pages retain the existing selected playback source and reuse existing
  detail, playback, watchlist and playlist actions.

## Data and persistence

Discover episode counts describe broadcasts, not the installed source's playable
episodes. Unknown counts stay unknown. Optional catalogue filter variables are
omitted rather than sent as explicit null values.

The calendar queries saved titles only. Numeric AniList identities are reused;
other identities require a unique exact title/year metadata match. Ambiguous
matches are not guessed. Raw broadcast responses are cached while watched flags
are recalculated from current local progress. AniList's
[AiringSchedule reference](https://docs.anilist.co/reference/object/airingschedule)
describes its airing data; historical coverage is not guaranteed.

Playback snapshots belong to their own session. Switching episodes or closing
the player saves the previous ready position without borrowing the new video's
clock. Meaningful playback promotes an existing Plan to Watch entry to Currently
Watching; explicit Completed, On Hold and Dropped statuses remain respected.

Episode numbers are optional additions to progress/history records, preserving
existing keys. Older progress without a known episode number cannot safely hide
a calendar episode. Home can recover missing metadata for numeric AniList IDs;
opaque legacy source IDs without title snapshots need the title reopened once.
No fabricated history entries are written during metadata recovery.

## Verification

- Nova Electron and renderer type checks and production build pass.
- `pnpm test:anime:hub`: 13 deterministic model, storage, catalogue and calendar
  checks pass.
- `pnpm test:anime:hub:ui`: four hidden Electron scenario groups cover Home,
  Discover, Schedule and session-owned playback persistence.
- Existing anime UI (14 groups), player loading (two groups) and buffering
  (21 cases) checks pass, together with storage/core type checks.
- Astro documentation build passes with 15 routes.
- Live catalogue smoke returned 20 titles in each discovery feed. A live saved
  title calendar query completed with zero broadcasts in that week; this is a
  transport observation, not proof of schedule coverage.
- Fixture layouts were reviewed at desktop and mobile widths. No installer was
  generated and no live source playback was performed for this UI change.

Run the built app with `pnpm --filter @vestra/nova start`.
