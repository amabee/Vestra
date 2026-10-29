# Windows worker packaging

Nova now ships the C# provider worker as a self-contained Windows x64 executable.
The package includes .NET and ASP.NET runtime files beside `Vestra.Server.exe`;
no trimming or NativeAOT is used because the provider interpreter requires dynamic
behavior. Other operating systems and architectures are not yet supported by this
packaging path, and the package hook rejects mismatched targets.

## Build

```powershell
pnpm --filter @vestra/nova package
```

This fetches mpv, publishes the worker, builds Electron/renderer assets and creates
the Windows x64 installer. Development builds still require the .NET SDK to build
the worker. Installed copies execute their bundled worker directly.

`pnpm --filter @vestra/nova package:dir` creates an unpacked Windows application
using already-present mpv assets. `pnpm test:server:packaged` publishes the worker,
builds Electron assets and runs the SDK-hidden worker/compiler smoke checks.

Worker publishing uses a temporary directory, validates runtime files and the
self-contained runtime configuration, then replaces the previous vendor output.
The package hook checks its architecture/manifest, native runtime and compiler
before Electron packaging. Generated runtime binaries stay under ignored vendor
and release directories.

## Runtime selection

- Packaged Windows x64 Nova uses `resources/server/Vestra.Server.exe` and ignores
  the development DLL override. Worker requests remain private stdin/stdout IPC.
- Development uses the existing Release DLL through `dotnet`, with the existing
  `VESTRA_CSHARP_SERVER_DLL` override supported.
- Worker recovery restarts the same selected executable and reloads successful
  provider definitions. Cancellation and interrupted-call behavior are unchanged.
- A missing worker or launch failure produces an actionable error in Sources.
- Local source imports are enabled in packaged builds; the legacy environment
  configuration remains a development-only first-run seed.

The trusted TypeScript compiler is copied as `dist-electron/provider-typescript.cjs`
with its license. It is loaded as a sibling asset, including from the packaged
ASAR, rather than requiring installed development modules. Provider source is only
transformed; imports/modules remain unsupported and guest scripts execute in Jint.

## Verification boundary

The smoke checks run both the published output and the worker copied into the
unpacked Windows application's resources. They extract the compiler from the
actual `app.asar`, use it outside any node_modules tree, and execute the resulting
TypeScript provider in the bundled worker. Child processes hide SDK tools from
PATH and redirect .NET runtime-discovery environment variables. The runtime config
and local native runtime files are checked as well.

Three packaging checks pass, including the five worker-protocol regression cases
against the executable: dispatch, errors, cancellation/recovery, and persistent
state across restart. Six source-management tests, four reader tests and Nova
type checks/builds also pass.

This is not a clean-machine installation test: the development machine still has
.NET installed. Installing on a clean Windows machine, interacting with the native
file chooser, visual playback/reading checks and verifying the complete application
shutdown remain release gates. No speedup or full Seanime parity is claimed.

To check the resources from an unpacked build directly:

```powershell
node apps/nova/scripts/test-packaged-worker.mjs --resources apps/nova/release/win-unpacked/resources
```
