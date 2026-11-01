# MovieBox for Vestra

Native SDK 1.4 source for Movies and TV. This is an independent Vestra integration
of the public website's guest flow, not a CloudStream package or a copied provider.

Open **Extensions → Choose extension folder** and select `extensions/moviebox`.
Review network and source-session permissions and install. Select MovieBox in
Movies or Series, then search or browse Popular/Latest. No installer is needed;
rebuild Nova after pulling SDK changes before using `pnpm --filter @vestra/nova start`.

The source keeps a short-lived guest token only in its own isolate. It does not
read browser cookies, use an existing account or persist a token to disk. Network
hosts stay explicit in the manifest and all API requests use the host broker.

Search/discovery do not extract streams. Titles keep exact string IDs, including
IDs beyond JavaScript's safe integer range. Repeated season search results are
combined into one series; available episodes retain specials and explicit gaps.
Stream extraction occurs on play and preserves the full title Referer required
by the player origin. Subtitle failure does not prevent otherwise playable video.

Only accessible MP4/HLS renditions are returned. Premium-locked tracks, preview/
guest limits, signed-header tracks and unsupported DASH tracks are not offered.
Quality labels come from the source: live guest checks returned 360p/480p, while
1080p was locked. The source cannot promise HD guest access. Subscription login
and persistent account sessions are not implemented.

Deterministic checks run in the actual isolate and network broker:

```powershell
pnpm test:moviebox
```

Explicit live checks contact the site and read a bounded video sample:

```powershell
pnpm test:moviebox:live
```

Live results are observations, not a guarantee that all titles or regions work.
The website and its player/CDN hosts can change; update the extension and review
new grants if that happens. No challenge solving, account-login automation or
premium-unlocking mechanism is included.
