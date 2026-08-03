Vestra — Master Project Prompt

Build a premium cross-platform media platform called "Vestra" using Electron + Next.js (App Router) + TypeScript.

Vestra uses a branded multi-app architecture:

- Vestra Atlas → Web application (Next.js)
- Vestra Nova → Desktop application (Electron)
- Vestra Pulse → Mobile application (React Native / Expo, scaffold only for future support)
- Vestra Core → Shared business logic, types, API clients, and utilities

Before generating any code, first create the complete monorepo folder structure and initialize all app and package directories.

Vestra is a unified entertainment platform that lets users search, organize, and watch content from multiple sources in one place, including:

- Anime (AniList API)
- Movies and TV shows (TMDb API)
- K-Dramas (TMDb TV category)
- YouTube videos (YouTube Data API)
- Local media files stored on the user's computer

The application should feel like a combination of Plex, Stremio, AniList, and YouTube, but with a clean modern UI similar to Arc Browser, Notion, and Raycast.

Tech stack:
- Electron for Vestra Nova
- Next.js 15+ with App Router for Vestra Atlas
- React Native + Expo scaffold for Vestra Pulse
- TypeScript everywhere
- Tailwind CSS
- shadcn/ui components
- Zustand for client state
- React Query (TanStack Query) for API data
- Framer Motion for subtle animations
- keytar for secure OAuth token storage (desktop)
- Local JSON storage for watchlist, history, and settings

Design requirements:
- Dark mode first
- Premium glassmorphism + soft shadows
- Rounded 2xl/3xl corners
- Smooth 150-250ms animations
- Minimal but cinematic
- Accent color: deep violet (#7C3AED) with electric blue highlights

Main layout:
- Collapsible left sidebar
- Top global search bar
- Main content area
- Optional right details panel

Sidebar sections:
- Home
- Discover
- Anime
- Movies
- TV Shows
- K-Drama
- YouTube
- Local Library
- Watchlist
- History
- Settings

Home page:
- Continue Watching
- Trending Anime
- Trending Movies
- Trending K-Dramas
- Recommended For You
- Recently Added Local Media

Universal search:
- Search across all enabled sources simultaneously
- Group results by source
- Keyboard navigation
- Debounced search
- Recent searches

Media details page:
- Poster/backdrop
- Title
- Year
- Genres
- Rating
- Overview
- Cast
- Episodes (for series)
- Related content
- Add to Watchlist
- Mark as Watched
- Open in Source / Play

YouTube integration:
- Embedded playback for public videos
- Show channel and duration
- Save to watchlist

Local library:
- Scan user-selected folders
- Detect video files
- Generate thumbnails if possible
- Track playback progress

Watch progress:
- Store progress locally in JSON
- Resume from last position
- Sync-ready architecture for future cloud support

Settings:
- Theme
- Accent color
- API connections
- Media folders
- Playback preferences
- Privacy controls

Electron requirements (Vestra Nova):
- Native title bar hidden
- Custom draggable top bar
- System tray support
- Auto-update architecture placeholder
- Secure preload script with context isolation

First generate this exact folder structure:

vestra/
├─ apps/
│  ├─ atlas/                 # Next.js web app
│  ├─ nova/                  # Electron desktop app
│  └─ pulse/                 # React Native / Expo scaffold
├─ packages/
│  ├─ core/                  # Shared business logic
│  ├─ ui/                    # Shared UI components
│  ├─ api/                   # API clients (TMDb, AniList, YouTube)
│  ├─ storage/               # JSON persistence helpers
│  ├─ config/                # Shared configs
│  └─ types/                 # Shared TypeScript types
├─ tooling/
│  ├─ eslint/
│  ├─ typescript/
│  └─ tailwind/
├─ .env.example
├─ package.json
├─ turbo.json
├─ pnpm-workspace.yaml
└─ README.md

Branding:
- Product name: Vestra
- Web app: Vestra Atlas
- Desktop app: Vestra Nova
- Mobile app: Vestra Pulse
- Shared engine: Vestra Core

Generate:
1. Complete monorepo folder structure
2. Root package.json
3. pnpm workspace configuration
4. Turborepo configuration
5. Vestra Atlas (Next.js) setup
6. Vestra Nova (Electron) setup
7. Vestra Pulse (Expo) scaffold
8. Shared package configurations
9. Tailwind + shadcn configuration
10. Zustand stores
11. React Query providers
12. Example API integrations (TMDb + AniList)
13. Home page UI
14. Universal search component
15. Media card components
16. Watchlist persistence
17. Dark premium styling
18. Framer Motion transitions

The code should be production-oriented, strongly typed, scalable, and easy to extend for future features such as cloud sync, plugins, offline mode, and mobile synchronization.
