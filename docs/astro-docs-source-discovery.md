# Astro documentation and anime source discovery

Implemented 2026-11-01. The documentation site is `apps/docs`, built with Astro
7.4.4 as static output. Run `pnpm dev:docs` from the repository root; it binds to
127.0.0.1:4321. Build with `pnpm build:docs`. No public host or deployment was
configured. Existing SDK quickstart and manga Markdown are loaded directly through
content collections. The route index selects only the intended public guides;
historical engineering records are not published automatically.

The site includes app setup, extension installation, anime/manga authoring,
SDK discovery, manifest/host references, publishing, troubleshooting, local document
search, code copying, responsive reference navigation and a static 404. Fonts are
self-hosted. Relative Markdown links resolve to published pages or repository files.
The docs workspace overrides Turbo's normal Markdown exclusion so canonical source
changes participate in the site build cache. Astro's typechecker needs a targeted
package extension for astro2tsx 0.1.3's unpublished runtime peer under pnpm.

## Source browsing

Anime now has a Browse sources tab. Source, category and page are URL-backed; the
existing selected-source preference remains the only source-selection authority.
The same card actions open details, play, save Watch later and choose a playlist.
Changing sources resets category/page; unavailable sources are not replaced silently.

SDK 1.2 native stream-source manifests can declare `discovery.categories` from
suggested, ongoing, latest, upcoming and popular and export `browse(category,
{ page, limit })`. The authoring template demonstrates one Suggested page with
placeholder titles, not a live site integration. Required streaming methods remain
search/getEpisodes/getStreams. Declared feeds without browse fail method validation.

The host validates category/page, stamps provider identity, rejects duplicate IDs,
malformed pages and over-24-item responses, and preserves source title IDs into
existing details/playback. Native feed caches are per registered provider instance,
category and page. Disabled/replaced sources reject late results; UI extension
lifecycle changes invalidate discovery queries. Failed feed requests can retry.

Current compatibility sources have no discovery method. They receive explicitly
labelled AniList catalogue discovery while keeping their selected playback source.
Availability is checked when a title is opened, not asserted from a catalogue card.
Suggested uses catalogue trends, ongoing filters RELEASING, latest sorts released
start dates, upcoming filters NOT_YET_RELEASED and popular uses popularity. These
are not personalized recommendations or confirmed source-owned feeds. Native feed
implementations are still a separate integration task.

The existing Manga catalogue HTTP helper was extracted into a shared module;
its public alias and rate-limit behavior remain compatible.

## Verification

- Astro static build: 15 routes; Astro check: zero errors, warnings or hints.
- 330 built internal links/heading anchors validated.
- Hidden browser checks cover 320/375/1280/1920 widths, canonical guide links,
  isolated clipboard fixture, mobile disclosure, local search and query state,
  keyboard search navigation, no-JavaScript reading and zero page-script errors.
- Hallmark rendered sweep: zero FAIL and REFLEX; three warnings accepted for
  short single-sentence descriptions and the skill's no-balanced-heading rule.
  Independent finish review: ship. Reference pages inspected on desktop/mobile.
- Extension-host suite: 136 cases including seven discovery cases and real QuickJS
  template execution. Focused discovery suite passes after final method checks.
- Backend discovery: four cases for source isolation, cache/page identity,
  catalogue filters, late-result rejection and retry/input validation.
- Existing AnimeService: 16 cases; manga discovery: six; installer: four.
- Hidden anime/extension UI: 14 scenario groups, including native categories,
  pagination, direct source playback, source changes, fallback labels, empty and
  error/retry states. Discovery captured at 1440 and 375 pixels without overflow.
- Nova typecheck and Electron/renderer production builds pass.
- One live AniList GraphQL request confirmed current ongoing/upcoming/latest
  filters. No live native provider feed beyond the controlled authoring template
  was claimed or installed, and no media playback benchmark was repeated.

No installer was generated or installed for this change. Use the freshly built
app with `pnpm --filter @vestra/nova start`, or `dev` for UI development.
