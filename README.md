# Vestra

A unified entertainment platform. Anime, movies, TV, K-drama, YouTube and your
own local media in one place — with a dark, cinematic interface.

Vestra ships as a branded multi-app monorepo:

| App                              | Package          | Stack                     | Status          |
| -------------------------------- | ---------------- | ------------------------- | --------------- |
| **Vestra Atlas** — web           | `@vestra/atlas`  | Next.js 16 (App Router)   | Working         |
| **Vestra Nova** — desktop        | `@vestra/nova`   | Electron 43               | Shell complete  |
| **Vestra Pulse** — mobile        | `@vestra/pulse`  | React Native / Expo       | Scaffold only   |
| **Vestra Core** — shared engine  | `@vestra/core`   | TypeScript                | Working         |

## Quick start

```bash
pnpm install
cp .env.example .env.local        # optional — see "Providers" below
pnpm --filter @vestra/atlas dev   # http://localhost:3000
```

**Anime works with zero configuration** — AniList's public API needs no key.
Movies, TV and K-drama require a free TMDb key.

## Providers

| Source           | Key required                                   | Powers                                  |
| ---------------- | ---------------------------------------------- | --------------------------------------- |
| AniList          | No                                             | Anime catalogue, trending, details       |
| TMDb             | `TMDB_ACCESS_TOKEN` or `TMDB_API_KEY`          | Movies, TV shows, K-drama                |
| YouTube Data v3  | `YOUTUBE_API_KEY`                              | Video search, embedded playback          |
| Jellyfin         | `MEDIA_SERVER_URL` + `MEDIA_SERVER_API_KEY`    | Your own server's library and streams    |
| qBittorrent      | `QBITTORRENT_URL` + credentials                | Transfer control and completed files     |
| Local files      | No                                             | Disk library (Nova only)                 |

Every source degrades independently. An unconfigured or failing provider shows
an inline notice on its own row and never breaks the page.

### On qBittorrent

Vestra drives **your own** qBittorrent instance through its Web API — list,
add, pause, resume and read completed file paths, so finished downloads feed the
local library. Vestra ships no trackers, indexers or content search, exactly like
the Sonarr/Radarr/Jellyfin stack it sits alongside.

## Structure

```
vestra/
├─ apps/
│  ├─ atlas/         Next.js web app
│  ├─ nova/          Electron desktop shell
│  └─ pulse/         Expo scaffold
├─ packages/
│  ├─ types/         Zod schemas + the normalised domain model
│  ├─ config/        Env validation, constants, navigation
│  ├─ api/           TMDb · AniList · YouTube · qBittorrent · Jellyfin clients
│  ├─ storage/       Atomic JSON persistence
│  ├─ core/          Search aggregation, discovery, filename parsing, formatting
│  └─ ui/            Shared React components
└─ tooling/          Shared TypeScript, ESLint and Tailwind config
```

### Architecture notes

- **One normalised model.** Every provider maps into `MediaItem` / `MediaDetails`
  from `@vestra/types`, so a TMDb film and an AniList series render through the
  same card. Ratings are normalised to 0–100 regardless of the source's scale.
- **Source-shipping internal packages.** `packages/*` export raw TypeScript and
  are compiled by the consumer via `transpilePackages`. There is no build step.
  Relative imports are extensionless — `.js` specifiers do not resolve under
  Turbopack for workspace packages.
- **Credentials stay server-side.** `@vestra/api` and `@vestra/storage` are only
  imported from Server Components, route handlers or the Electron main process.
  `apps/atlas/src/lib/storage.ts` is marked `server-only` to enforce this.
- **Isolated failures.** `universalSearch()` runs providers concurrently and
  captures errors per source, so one dead provider degrades one group.
- **Atomic writes.** `NodeDriver` writes to a temp file and renames, with a
  per-key lock, so a crash or concurrent write can't corrupt a document.

## Commands

```bash
pnpm dev                 # every app via Turborepo
pnpm dev:atlas           # web only  → http://localhost:3000
pnpm dev:nova            # desktop   → starts Atlas, waits for it, opens Electron
pnpm build               # build all
pnpm typecheck           # tsc --noEmit across the workspace
pnpm lint
pnpm format
```

## Data

Watchlist, history, progress, settings and the local library index are stored as
JSON. Atlas writes to `<cwd>/.vestra`; override with `VESTRA_DATA_DIR`. Nova will
use the OS app-data directory. The repository layer is deliberately thin so a
SQLite or cloud-sync backend can replace it without touching callers.

## Working in this repo

### Branches

`main` is the trunk and is always releasable. Work happens on short-lived
branches prefixed with the app or package they target:

```
atlas/<topic>     nova/<topic>     pulse/<topic>     core/<topic>
```

Long-lived `atlas` / `nova` / `pulse` branches exist as integration lanes, but
they are **not** meant to diverge from `main`.

> **Why not a permanent branch per app?** `packages/*` is shared by all three
> apps, so divergent app branches would need every core change merged three
> ways. pnpm also resolves `workspace:*` against the whole tree, so a branch
> missing sibling apps will not install. Keep the work on `main` and use the
> prefixes for tracking.

### Commits

Conventional Commits, scoped to the workspace package so `git log --grep` stays
useful:

```
feat(atlas): add hero banner to home
fix(ui): keep switch knob inside its track
build(deps): pin typescript to 6.x for eslint compatibility
```

Scopes: `atlas` `nova` `pulse` · `types` `config` `api` `storage` `core` `ui` ·
`eslint` `tsconfig` `tailwind` · `deps` `ci` `release`.

A template is wired up through `commit.template` — run `git commit` with no
`-m` to get the full list inline.

### Tags

| Pattern          | Meaning                   |
| ---------------- | ------------------------- |
| `v<x.y.z>`       | Repository-wide milestone |
| `atlas-v<x.y.z>` | Vestra Atlas release      |
| `nova-v<x.y.z>`  | Vestra Nova release       |
| `pulse-v<x.y.z>` | Vestra Pulse release      |

Tags are annotated and record what actually shipped, including what did not:
`git tag -n20 nova-v0.1.0`.

### Useful queries

```bash
git log --oneline --grep '(atlas)'   # everything that touched Atlas
git log --oneline -- packages/core   # history of the shared engine
git tag -l 'atlas-*'                 # Atlas release history
git shortlog -sn                     # commits by author
```

## Toolchain

Node 22+, pnpm 11, Turborepo 2, TypeScript 6, Tailwind CSS v4, React 19.

> TypeScript is pinned to 6.x. TypeScript 7 (the native rewrite) is released, but
> `typescript-eslint@8` declares `typescript: <6.1.0`, so upgrading breaks lint.
