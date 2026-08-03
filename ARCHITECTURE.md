# Vestra — application layout

## Today

| Path | What it is |
| --- | --- |
| `apps/nova` | The Electron shell: window, tray, IPC, extension isolates |
| `apps/nova-app` | The Next.js app Nova serves — UI, route handlers, provider registry |
| `packages/*` | Portable logic shared by any future client |
| `apps/pulse` | Expo scaffold, not started |

`apps/nova-app` was previously called `apps/atlas`. The name implied a shared
web application, but nothing else consumed it: Nova spawns it on loopback and
renders it in a `BrowserWindow`. Calling it Nova's app matches what it is, and
removes the awkwardness of "focus on Nova" meaning "edit Atlas".

Both are Nova's. Edit freely.

## The web application

Deferred, and **greenfield when it happens** — it is not a fork of `nova-app`.

The plan is a thin client over an external API the repository owner is
designing. It shares `packages/*` and nothing else. There is no code for it yet
and none should be written until that API contract is settled, because the
contract determines the shape of everything above it.

When it starts it lands in `apps/web`.

## Why the split is cheap

Roughly 8,100 lines already live in `packages/*` — providers, storage, the
extension host, types, the API clients. `apps/nova-app` is about 6,200 lines
and roughly 80% of that is UI. The route handlers are thin wrappers over
packages, which is what makes a second client tractable later.

## Possible future: dropping Next.js from Nova

Nova currently runs a local HTTP server because the app is a Next.js app. That
works and is verified, but it costs a port, a process and startup time.

The alternative is replacing the route handlers with IPC and porting the UI to
a plain SPA. The handlers are the easy half — they are thin. The UI is roughly
5,000 lines built on the App Router, server components and `next/navigation`,
so it is a real port rather than a move.

Not worth doing while the UI is still changing shape. Revisit once it settles.
