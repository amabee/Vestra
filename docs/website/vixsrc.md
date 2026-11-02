# VixSrc source

VixSrc adds native Movies and TV playback. Vestra supplies search, artwork,
details and aired episodes through its existing TMDb catalogue; the extension
matches exact IDs against the source and resolves video when you press Play.

## Set up

Configure `TMDB_ACCESS_TOKEN` or `TMDB_API_KEY` in Vestra's host environment.
The credential stays in Vestra and is never passed to the extension.
Without that configuration, catalogue search and TV episode loading cannot work.

Use a current build supporting SDK 1.5. From a source checkout:

```powershell
pnpm --filter @vestra/nova build
pnpm --filter @vestra/nova start
```

Open **Extensions → Choose extension folder**, choose `extensions/vixsrc`,
review its network and source-session permissions, and install. This local
source is not yet published as a pinned registry release.

## Watch

Open Movies or Series and search or browse Popular. Open a title, then select
VixSrc in **Watch with** if it is available. Playback uses the existing native
player. Popular reflects TMDb ranking filtered by source availability.

The title index does not promise every episode. Vestra lists aired catalogue
episodes and checks the selected episode on Play. Missing episodes show a source
error. Specials retain their own season; future or unknown-air-date episodes
are omitted. Large series are bounded to 60 seasons and 2,000 episodes.

## Quality and captions

The source preserves the complete HLS master, including alternate audio and
subtitle groups. Auto uses the player's quality policy. Resolution, languages
and delivery speed depend on the title and source; a successful sample does not
guarantee every region or title works.

If metadata fails, verify host TMDb configuration. If playback fails, retry once
to obtain a fresh link or choose another installed source. Repeated retries
cannot make an unavailable episode appear.
