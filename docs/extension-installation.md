# Extension listing installation

Updated: 2026-11-01.

## Install flow

Extensions has a single Add an extension form: paste a manifest URL, review its
permissions, then install. No registry or manually entered extension ID is needed
for a direct link. The host fetches one bounded manifest, derives identity and
format, and uses the same SDK or optional compatibility review as registry installs.
Preview does not execute or install the extension. Folder installation and script
import are available beside the URL form, and success messages point users to
their installed source.

Installed and Browse have search and Anime/Manga/Other category filters. Browse
has a direct Add a registry action when empty. Compatibility remains a separate
optional section. Mobile navigation wraps into two columns instead of hiding tabs
behind a horizontal scrollbar.

The direct-link path is tested for native manga SDK detection, compatibility
dispatch, malformed identity rejection and one manifest fetch. The hidden UI
fixture exercises URL review/cancel, search, existing source controls and registry
installation; layouts were inspected at 1200 and 375 pixels.

## Registry installation history

The Available list previously required `payloadURI` on every registry row. The
configured Seanime-Providers registry often supplies only `manifestURI`, with the
code URL in the individual manifest. This made valid listings show “No code listed”
and disabled Review before any manifest could be read.

Available now requires a manifest URL. `extensions:prepare` validates the listing,
fetches one bounded manifest through the guarded transport, checks its identity,
and chooses the existing installer by manifest format:

- Vestra SDK manifests use the isolated SDK install/review path. A missing listing
  code URL is resolved from the manifest's `payloadURI`, or its relative `main`.
- Seanime anime/manga provider-script manifests use `RemoteSourceService` and the
  existing C# SourceManager. Their script bytes are downloaded, hashed and staged
  for review; nothing is installed or executed during preview.
- Other non-SDK runtime formats report a clear unsupported-format error. Showing
  a registry entry does not establish that its upstream runtime is implemented.

Manifest identity/content-type mismatches, insecure URLs, oversized artifacts and
checksum mismatches still fail before installation. Provider host suggestions come
from declared hosts, or exact literal HTTPS hostnames found in older scripts without
host declarations. Inferred hosts are labelled as suggestions. Only the hostnames
approved in the review are granted, and staged bytes cannot change after review.
Installed-state detection includes managed providers as well as SDK extensions, so
a provider already managed in Extensions is not offered as a second installation.
Existing IDs, scripts, settings, grants, versions and rollback history are reused.

Verification: three dispatch/identity/grant cases, the existing five remote-source
cases, 29 SDK install/storage cases, and an offscreen Available-list flow that
reviews a manifest-only listing, approves its hosts, installs it, and shows Installed.
The live AnimeAV1 1.3.0 TypeScript manifest was downloaded from the same upstream
repository as the configured Available list. Its script was transpiled, installed,
and executed (`getSettings`) in an isolated C# worker/store with status ready.
This did not add anything to the user's actual installed-extension records, and
is not a claim that every provider website or every listed extension type works.

Commands:

```powershell
pnpm test:extensions:install
pnpm test:extensions:install:live
pnpm test:anime:ui
```
