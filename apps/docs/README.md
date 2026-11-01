# Vestra documentation (Astro)

From the repository root:

```powershell
pnpm dev:docs
pnpm build:docs
pnpm --filter @vestra/docs preview
```

Development and preview bind to `http://127.0.0.1:4321`. Build output is
`apps/docs/dist`, suitable for static hosting. These commands do not deploy it.
Node.js must satisfy the engine requirement in this workspace package.

Canonical articles live in `docs/website`, `docs/extension-quickstart.md` and
`docs/native-manga-sdk.md`. Astro content collections load them directly. There
is no second copied guide to synchronize. The ordered route/navigation manifest
is `src/lib/pages.mjs`. Update it when adding a page. A remark plugin rewrites
relative source links to published doc routes or the repository file.

Includes self-hosted fonts, responsive navigation, heading links, local document
search, code copying, adjacent-page navigation and a static 404. No search service
or credentials are required. Documentation remains accessible without JavaScript.

## Checks

Build, then run `pnpm --filter @vestra/docs typecheck` and
`pnpm --filter @vestra/docs test`. The browser check serves the built files on
an ephemeral loopback port and closes its own browser/server afterward. It uses
installed Edge on Windows; set `CHROME_PATH` for another Chrome/Chromium binary.
`DOCS_URL` optionally points the check at an already-running site.

Astro 7 uses the supported `unified` Markdown processor for the link-rewriting
plugin. The workspace's package extension supplies a missing published WASM peer
in astro2tsx 0.1.3 so `astro check` works with pnpm's isolated dependency layout.
See [Astro content collections](https://docs.astro.build/en/guides/content-collections/).
