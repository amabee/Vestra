# Vestra Pulse — Mobile

React Native / Expo client for Vestra. **Scaffold only** — not implemented yet.

## Why Expo and not Flutter

Expo keeps Pulse inside the pnpm workspace, so it imports `@vestra/core`,
`@vestra/types` and `@vestra/api` directly. A Flutter client would be Dart and
could not share any of that — the business logic would have to be either
duplicated in Dart or exposed over HTTP. Staying on TypeScript means one
implementation of search aggregation, normalisation and progress tracking.

## Getting started (when work begins)

```bash
cd apps/pulse
pnpm create expo-app . --template blank-typescript
```

Then:

1. Add `@vestra/core`, `@vestra/types` and `@vestra/ui` as `workspace:*` deps.
2. Configure Metro for the monorepo — it must follow symlinks and watch the
   workspace root:

   ```js
   // metro.config.js
   const { getDefaultConfig } = require("expo/metro-config");
   const path = require("node:path");

   const projectRoot = __dirname;
   const workspaceRoot = path.resolve(projectRoot, "../..");

   const config = getDefaultConfig(projectRoot);
   config.watchFolders = [workspaceRoot];
   config.resolver.nodeModulesPaths = [
     path.resolve(projectRoot, "node_modules"),
     path.resolve(workspaceRoot, "node_modules"),
   ];
   module.exports = config;
   ```

3. Provider calls must NOT run on-device — API keys would ship in the bundle.
   Point Pulse at Atlas's route handlers (`/api/search`, `/api/watchlist`,
   `/api/progress`) instead, and reuse `@vestra/types` for the response shapes.
4. `@vestra/ui` is DOM-based and will not render in React Native. Build a
   parallel `packages/ui-native` if components need to be shared; `@vestra/core`
   and `@vestra/types` are already platform-agnostic.

## Target feature set

Home rows · universal search · watchlist · continue watching · YouTube playback ·
offline metadata cache.
