# Vestra settings implementation

Working context: `codex/settings-expansion`, clean baseline on main.

## Architecture inspected

- `packages/types/src/settings.ts`: Zod defaults and strict patch schema; version 1 settings.
- `packages/storage/src/repositories.ts`: one settings document through NodeDriver; invalid documents currently fall back wholesale.
- `apps/nova/electron/settings-service.ts`, `ipc.ts`, `preload.ts`: queued patches and window broadcasts; native folder picker; progress/history IPC.
- `renderer/src/routes/system.tsx`, `routes/settings.css`: reusable Setting/Switch controls, section navigation, save feedback; section-only search.
- `renderer/src/components/chrome/{appearance,app-shell,nav-rail}.tsx`: live CSS theme, startup route, rail.
- `renderer/src/components/media/anime-{hub-cards,source-preference}.tsx/ts`: shared anime posters and remembered source; no anime card trailer service.
- `packages/providers/src/scanner.ts`: bounded filesystem scan; currently drops unavailable/removed roots from index.
- `electron/extensions.ts`, `extension-worker.ts`: QuickJS isolation, brokered host allowlists and SSRF protection always enforced.
- `packages/providers/src/anilist.ts`, `packages/api/src/anilist`: public catalogue only; no OAuth/account/list backup integration exists.
- Manga has separate source/library/reader services; only expose sorting backed by actual stored fields.

## Dependencies and compatibility

Retain version 1 additive defaults and existing document. Recover invalid individual fields without losing valid sections. Adult blur depends on adult visibility; media blur depends on global blur; retain child preferences. Native file access stays in main. Import only allowlisted local configuration, never account/source credentials. Secure mode adds restrictions without disabling existing sandbox/network protections. Decoder changes retain existing restart requirement.

## Phases / checklist

- [x] 0: Inspect and establish isolated branch and plan.
- [x] 1: Extend validated defaults/patches and safe recovery; test persistence.
- [x] 2: Playback/history controls, source preference, anime privacy, extension policy; explicit account service limitations.
- [x] 3: Live colors, backgrounds and banner rendering.
- [x] 4: Navigation/layout/effects and supported card/episode behaviors.
- [x] 5: Safe folder management, scan coordination and startup/automatic refresh.
- [x] 6: Validated scanner JSON and local-only configuration import/export.
- [x] 7: Targeted tests, typecheck/build, regression checks and limitation audit.

## Implementation log

- Baseline inspected. No new dependencies planned. Missing integrations must be called out explicitly, never represented by working-looking switches.

- Phases 1–6 implemented using the existing document, IPC bridge, React Query and CSS tokens. Targeted persistence/scanner tests and Nova typecheck pass.
- Native folder and registry mutations now use the same save queue and broadcasts as settings patches.
- Startup/manual/automatic scans share one promise; the underlying scanner also queues calls from download auto-imports; root metadata is checked every minute. All preexisting records survive missing roots, scan bounds or directory removal.
- Secure Mode checks each QuickJS call and brokered request, blocks grants beyond basic network access, and never weakens sandbox/SSRF/allowlist rules. C# provider sources retain their separate existing policy.
- Local image serving uses a fixed appearance protocol endpoint, permitted raster extensions and a 20 MB bound; renderer paths never select protocol files.
- Local import/export is a strict versioned scan-preference allowlist; excludes directories, accounts, tokens and extension grants.

## Integration limits (explicit, no disconnected controls)

- [x] AniList connection, identity, disconnect and automatic backups are integrated. Tokens and private list backups use OS encryption. The browser PIN flow needs a registered public client ID or an already issued access token; no client secret is shipped.
- [x] Anime unwatched and manga unread badges use known inventories and recorded completions. Provider-specific episode inventories and chapter completion metadata persist in the existing storage driver. Unknown historical progress stays unknown; manga Details provides explicit reconciliation without changing resume positions.
- Anime cards have no trailer player; carousels have no automatic scrolling. Their requested disable switches are unnecessary in the current implementation and are explained in Settings.
- Automatic refresh checks root directory metadata; deep edits inside unchanged subfolders require manual scanning. No scan stream/progress API exists; manual scan has pending/error/result feedback.
- Adult flags apply when supplied by the provider; unlabelled third-party content cannot be classified locally. Public discovery feeds remain non-adult regardless of the adult preference. Existing snapshots lacking adult flags gain them when metadata is refreshed.
- [x] Anime, movie/TV and manga detail pages share the banner policy and blurred-background component. Manga backdrops use the existing protected artwork handles. All seven modes, sizes, opacity, position and blur dependency apply.
- All new implemented preferences apply immediately or on the next scan/navigation. Existing hardware decoder change requires application restart; startup route applies on next launch.

## Verification

- `pnpm typecheck`: all 12 configured workspace checks pass; docs reports no diagnostics.
- Lint: types, storage, providers and API packages pass. Nova has no lint script.
- `pnpm test:settings:expansion`: real filesystem reload, invalid-field recovery, queued patches/folder mutations, strict imports, scanner bounds/exclusions/offline retention, shared scan requests and live Secure Mode checks pass.
- `pnpm test:settings`: existing encrypted TMDb/torrent persistence and diagnostic/settings regressions pass.
- `node apps/nova/scripts/test-settings-ui.mjs`: Electron-rendered search, dependency retention, source saving, scanner validation, live colors, navigation, failed-save feedback, downloads, diagnostics and updates pass. Layouts reviewed at 1280 and 700 pixels.
- Extension-host: 186 tests pass. Anime hub: 13 tests; manga reader navigation: 8; player quality state: 1 pass.
- Nova Electron + renderer production build passes. Vite retains a bundle-size advisory.
- Native dialogs were not driven interactively; no live authenticated account or third-party playback verification was attempted.

## Changed file inventory

New:

- `apps/nova/electron/library-refresh.ts`: shared scans and automatic scheduling.
- `apps/nova/renderer/src/components/settings/{preferences.tsx,search.ts}`: typed preference controls, scanner editor and shared search.
- `apps/nova/renderer/src/lib/navigation-preload.ts`: preload existing lazy chunks.
- `apps/nova/scripts/test-settings-{expansion,services}.mjs`: persistence, scanner and host-policy regression checks.
- This implementation document.

Modified:

- `packages/types/src/{settings,media}.ts`, `packages/storage/src/repositories.ts`: defaults, strict patches/imports, recovery, adult flag.
- `packages/providers/src/scanner.ts`, `packages/api/src/anilist/normalize.ts`: scanner behavior and adult metadata.
- `apps/nova/electron/{settings-service,ipc,preload,main,extensions,media-protocol,anime-explore}.ts`: queue, native files, lifecycle, security and metadata.
- Renderer chrome: `components/chrome/{appearance,app-shell,nav-rail}.tsx`.
- Renderer media: `components/media/{anime-details,anime-hub-cards,anime-hub-context,catalogue-entry,media-card}.tsx`.
- Renderer library/playback: `components/manga/manga-library.tsx`, `components/player/use-playback-persistence.ts`.
- Renderer routes: `{system,home,discover,collections}.tsx`, `routes/settings.css`, `styles/theme.css`, `lib/bridge.ts`.
- `apps/nova/scripts/test-settings-ui.mjs`, root `package.json`: expanded UI coverage and test command.

## Remaining integrations — follow-up

- [x] Authenticated AniList account service with encrypted tokens, connect/disconnect, identity/status and bounded automatic list backups.
- [x] Anime episode inventories and exact unwatched badges; persisted manga chapter completions and unread badges without inferring skipped chapters.
- [x] Shared media-banner behavior across anime, movie/TV and manga details.
- [x] Targeted service, persistence, UI and regression validation.
      Use AniList's documented desktop OAuth token/PIN flow with a public client ID; never ship a client secret. Existing public catalogue access remains independent. Backups must include anime and manga, paginate fully, retain previous successful snapshots on failure, and pause on expired authorization. Chapter-count migration must label unknown historical completion rather than fabricate it.

### Follow-up implementation and validation

- `electron/anilist-account.ts` owns the authenticated session and atomic encrypted writes. IPC exposes status/actions only. The password input clears on submission and tokens are excluded from React Query mutation variables, status, export, settings and extensions.
- List backups query every chunk of both anime and manga collections, preserve private entries/list memberships/notes, normalize scores to POINT_100, retain seven encrypted snapshots per account, and export credential-free JSON on request. Automatic backups run once per 24 hours while open, retry transient failures after a delay and stop after authorization expires. Account changes cancel stale work.
- `electron/anime-inventories.ts`, `chapter-completions.ts` and shared `media-counts.ts` add bounded source inventories and completion tracking. Duplicate anime episode variants do not inflate counts; unnumbered legacy progress and truncated inventories never produce guessed totals. Manga counts do not assume chapters skipped on the way to a resume point were read. Final-page saves update completion metadata alongside the existing C# resume service.
- `components/media/media-banner.tsx` and shared `media-appearance.ts` unify details rendering; manga catalogue backdrops are fetched through the existing artwork broker. The existing layouts and playback/reading controls remain in place.
- Added `test-settings-integrations.mjs` for encrypted reconnect/restart, disconnect/cancellation, chunked private backups, retention/export, failure/backoff/expiry, count persistence and banner policies. Added `test-settings-integrations-ui.mjs` for actual manga banner rendering, fallbacks, dependencies, reconciliation, reading actions and widths 1280/700/420. Settings UI tests now cover account actions and count toggles; existing anime/screen fixtures use the current settings schema.
- Workspace typechecking, Nova build, package settings lint, settings regression suites, nine real C#-backed manga service tests, 13 anime hub tests, anime UI and movie/TV UI regressions pass. A pre-existing unsafe calendar-test DOM read was changed to wait for the route element.
- Remaining operational setup: the user authorizes their own AniList account. Live authentication was not attempted without credentials. Native dialogs retain the earlier implementation; export paths were not driven interactively. No new preference requires restart.

AniList setup: in [AniList developer settings](https://anilist.co/settings/developer), use `https://anilist.co/api/v2/oauth/pin` as the application's redirect. Enter its public client ID under Application → Local account & AniList, authorize in the browser, and paste the returned token. This follows [AniList's documented desktop PIN flow](https://docs.anilist.co/guide/auth/#auth-pin). Reconnecting restores backup status for that account; disconnecting removes its saved token and retains its encrypted snapshots.
