# Deferred: Vestra Atlas (`apps/atlas`)

**Status: frozen. Do not modify.**
**Decided: 2026-08-03**

## The rule

`apps/atlas/**` is off limits. Do not add, edit or delete files there, and do not
propose work whose next step lands in it.

This is scoped to the **app**, not the monorepo. These remain open:

| Path | Status |
| --- | --- |
| `apps/atlas/**` | frozen |
| `apps/nova/**` | active |
| `packages/**` | active |
| `tooling/**` | active |

## Why

Atlas is currently doing two jobs: it is the web app, and it is the backend Nova
spawns. Those are separating. The web target becomes a thin client over an
external API that the owner is still designing, so anything built into Atlas now
is likely to be rewritten or thrown away once that contract is settled.

Nova is the product being built. Work belongs where it will survive.

## What this means in practice

- Feature work goes in `packages/*` (portable) or `apps/nova/*` (desktop-specific).
- If a piece of work genuinely cannot proceed without an Atlas change, **stop and
  say so** rather than making the change or quietly routing around it.
- The extension runtime is the live example: the isolate lives in
  `packages/extension-host`, the host process is Nova. Atlas would only ever have
  been the UI surface, and that part waits.

## Already in Atlas

The extensions marketplace UI, its API routes, the SSRF guard and the
`VESTRA_HOST` gate all shipped before this freeze and are verified working. They
stay as they are. When the web/desktop split happens, they move rather than get
rewritten — most of the logic already lives in `packages/*` behind interfaces.

## Lifting the freeze

Only the repository owner lifts this, and the trigger is the external API
contract being settled. Until then, treat an Atlas change as out of scope.
