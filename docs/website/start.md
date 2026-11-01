# Start using Vestra

Vestra is a desktop app for discovering anime, watching video and reading manga.
Extensions connect the app to sources. You choose which ones to install and enable.

## Run from the repository

Install workspace dependencies with `pnpm install`. Build the C# worker and desktop
app once from the repository root:

```powershell
pnpm build:app
pnpm --filter @vestra/nova start
```

Development requires the .NET SDK, Node.js and the workspace's configured pnpm
version. The published Windows installer includes its own worker runtime.
`start` opens the existing build; it does not rebuild changed code. For app UI work,
run `pnpm --filter @vestra/nova dev` after building the worker.

## Connect your first source

Open Extensions and choose a folder, paste a manifest URL or browse a registry.
Review the requested permissions before installation. Enable your source, then
select it in Anime or Manga Library. A catalogue helps discover titles; the selected
source provides episodes or chapters.

## Keep your place

Use Watch later for a quick save or create named anime playlists. Manga remembers
reading progress through the host. Keep extension IDs stable when developing:
changing an ID creates a different source identity.

## Read next

- [Install an extension](extensions.md)
- [Browse your sources](browsing.md)
- [Build your first extension](../extension-quickstart.md)
