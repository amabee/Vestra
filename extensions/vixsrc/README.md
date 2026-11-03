# VixSrc for Vestra

Native SDK 1.5 Movies/TV source with HLS playback in Vestra's existing player.
Search, artwork, details and aired episode metadata use Vestra's configured TMDb
catalogue. The extension filters results against VixSrc's availability index.

## Use locally

1. Configure `TMDB_ACCESS_TOKEN` or `TMDB_API_KEY` in Vestra's environment. Keep
   credentials in the host; they are never sent to extension JavaScript.
2. Rebuild Nova: `pnpm --filter @vestra/nova build`.
3. Run `pnpm --filter @vestra/nova start`.
4. Open **Extensions → Choose extension folder**, select `extensions/vixsrc`,
   review its network/source-session permissions, and install.
5. Open Movies or Series. Search or browse Popular, open a title, then choose
   VixSrc in **Watch with** when available.

This requires the updated host with SDK 1.5 catalogue support. No published
manifest URL is provided until a release is pinned in the registry.

## Behavior and limits

- Catalogue availability is title-level. Episode availability is checked on Play;
  an aired catalogue episode can still be unavailable from the streaming source.
- Specials retain season 0. Episodes without a known air date and future episodes
  are omitted. Very large series are bounded to 60 seasons and 2,000 episodes.
- Extraction happens on Play. Short-lived embed URLs are consumed immediately;
  they are never reused as cached metadata.
- The HLS master remains intact to preserve alternate audio and subtitle groups.
  It is labelled Auto; available renditions depend on the title and Vestra's
  player quality setting. No HD guarantee is made for every title.
- No account, browser-cookie import or external subtitle service is needed for
  the verified public flow. Availability and CDN performance can vary by region.

## Checks

```powershell
pnpm test:vixsrc
pnpm test:vixsrc:live
# Also decode two seconds per sample with the bundled mpv, hidden and muted:
pnpm test:vixsrc:live --mpv
```

Live checks use the real isolate/broker and bounded samples without installing
the extension into a user profile. See [implementation notes](https://github.com/amabee/Vestra/blob/main/docs/vixsrc-source.md).
