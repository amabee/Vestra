# Source management preview

Nova's **Extensions** page, in its Provider extensions section, manages C# anime-streaming and manga providers.
Build the server with `pnpm build:server`, then run Nova in development. A provider
configuration environment variable is no longer required for local script imports.

Use **Import script** to select a local `.js` or `.ts` provider through the native
file chooser. Supply a stable ID, a name, content type and exact allowed website
hostnames. Advanced settings accept preferences as a JSON object, an optional
preferred server and the existing AnimeSaturn compatibility profile. Guest code is
transpiled where needed and executed only in the C# worker, never imported into
Electron's Node runtime.

Imports copy source text into Nova's atomic `csharp-managed-sources.json` document
in the app-data directory. Moving the original file does not break an installed
source. This management registry remains TypeScript/Node-backed; it is separate
from C# provider-script storage and C# reading progress. IDs are unique, source
scripts are limited to 1 MiB, preferences to 64 KiB and installed sources to 32.

The renderer receives an expiring token for a selected file, its basename and
size. It cannot submit an arbitrary source path to the import handler. Source
text and filesystem paths are omitted from list responses. All options are
validated again in main. Import tokens expire after ten minutes; at most four
pending imports are retained.

**Configure**, **Enable/Disable** and **Remove** apply without restarting Nova and
persist across application restarts. Remove drops the installed script and
registration but keeps provider state and reading progress. Settings changes
unload/reload the affected source; handles from the old registration may expire.
A failed disk write leaves the running configuration intact. An activation failure
remains visible on its source row and does not prevent other sources starting.
Disabled sources are removed from worker replay state even after cancellation.

**Check runtime** invokes the provider's `getSettings`, shows advertised stream
servers and validates the chosen server. It verifies provider execution rather
than making a website-health or playback claim. Loaded means the provider contract
was accepted. Network and playback errors still surface during search/reading/play.

On the first managed-source startup only, `VESTRA_CSHARP_PROVIDERS` can seed the
registry from the earlier configuration format. Later starts use saved copies;
editing the old config does not change installed sources. An empty saved registry
is respected, so removed entries are not reinstalled by that legacy config.

Windows x64 packages now include a self-contained C# worker and TypeScript compiler,
and local imports are enabled in packaged builds. Clean-machine install and visual
checks remain pending; see [worker-packaging.md](worker-packaging.md). Remote manifest
installs, reviewed updates and bounded version history are now implemented; see
[remote-sources.md](remote-sources.md). Unattended updates and full Seanime
extension-host parity remain pending. Local script replacement is described below.

Validation: `pnpm test:sources` builds the worker and runs eleven management tests,
including real C# lifecycle and disable-after-cancellation checks. Persistence,
invalid hosts/size/duplicate rejection, source failure isolation and failed disk
writes are covered. Existing five process tests and four reader-service tests,
Nova type checks and Electron/renderer builds also pass. The packaged initial
Sources screen, native chooser and a local MangaStash import have now been observed.
Configuration, error and lifecycle UI flows still need verification; see
[desktop-verification.md](desktop-verification.md).

## Replace a local provider script

Each source has **Replace script**. Select a local JS/TS file through the existing
native chooser, review the selected file and confirm replacement. The main process
uses its staged copy; the renderer never submits script text or an arbitrary path.
The review includes optional SHA256 fingerprints of the stored and selected source
text. A stale review is rejected if installed source contents changed in the meantime.

Replacement changes only source text and its filename. ID, content type, network
hosts, preferences, compatibility profile, preferred server and enabled state come
from the current saved record. Reading progress and the provider-store namespace
remain attached to that ID. An identical script/filename is a no-op.

For an enabled source, Nova unloads it, loads the candidate, invokes its validated
settings contract and checks the configured server before writing the new registry
document. If activation, settings validation or persistence fails, the previous
registry entry stays saved and Nova attempts to restore its runtime registration.
If restoration also fails, the source displays an error and can be enabled/checked
again after the worker problem is resolved. Reloading can expire existing playback
and page handles; cached UI data is invalidated after the operation.

A disabled source remains disabled and its replacement is saved without guest
execution. Contract validation is deferred until it is enabled. This local flow is separate from remote installation/update reviews. Up to three
previous scripts are now retained for explicit restoration. Candidate script initialization/settings can access its
own provider store; guest-side effects are not rolled back with the registry.

The eleven management tests cover settings/identity preservation, persisted
replacement across restart, partial activation rollback, failed writes, stale
reviews, disabled sources and restoration failure. The actual C# process also
rejects a missing contract or incompatible selected server, restores the old
script, and accepts a compatible replacement. Visual review/chooser testing for
this new flow remains deferred along with installer refresh.


As of 2026-10-30, there is no separate Sources navigation item or management page.
The import/configuration/controller was moved into
`components/extensions/provider-extensions.tsx`, rather than copied. Old `/sources`
links redirect to Extensions. Existing managed provider IDs, scripts, preferences,
host grants, updates and rollback history retain their storage format. The two
existing execution formats (C# provider scripts and isolated SDK extensions) remain
runtime adapters, managed through the single Extensions destination.

SDK extension records now optionally persist `enabled`. Older records remain enabled
by default. Disabling detaches their metadata/stream providers and unloads the worker
instance; startup skips disabled records. Enabling re-verifies the existing payload
fingerprint and reuses its recorded grant. A tampered payload must be reinstalled.
