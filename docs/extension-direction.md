# Vestra extension platform

Vestra is an independent product. Its features, extension API and release criteria
are defined by Vestra's needs. Porting Goja or matching another application's
complete feature set is no longer part of the roadmap.

## Primary format: Vestra SDK

New extensions should use Vestra's manifest, SDK version, permissions, host grants
and `activate` contract. The Extensions page opens on installed SDK extensions;
authors can load a local extension folder for review. Registries can distribute
SDK extensions through the existing reviewed installer.

- [Authoring guide](../packages/extension-host/README.md)
- [Native streaming template](../packages/extension-host/examples/stream-source-template/)
- [Metadata example](../packages/extension-host/examples/kitsu/)

The SDK supports metadata, streaming-source and native manga-source extensions.
SDK 1.1 manga sources connect to the library, details and reader through the
existing host services; see the [manga SDK guide](native-manga-sdk.md). New
provider APIs should be versioned and tested against Vestra's search, details,
playback and reading flows.

## Optional compatibility imports

The Compatibility tab manages existing anime and manga provider scripts, including
local imports, remote manifests, settings and updates. A registry entry using that
format opens a review labelled Compatibility import. Users choose whether to
import these providers; Vestra SDK extensions do not require them.

Existing imports remain enabled as configured. Their IDs, stored preferences,
host grants, playlists and progress are preserved. Compatibility formats retain
their original identifiers and documented semantics at the import boundary;
renaming those wire fields could break installed providers.

The C# worker currently uses Jint for provider JavaScript. The Vestra SDK uses its
existing isolate runtime. Unifying engines is a separate decision to make from
measured behavior and API requirements; this change does not replace either
engine. Native manga source routing shares the host's existing progress and
guarded image services.

## Project records

Earlier migration inventories and external runtime comparisons remain available
as historical technical evidence. They are not product branding or current
acceptance criteria. Original attribution and dependency notices remain intact.
The [current roadmap](roadmap.md) is the source of truth for future work.

## Native source replacement sequence

The gallery uses registry logos (or monograms), category summaries and an Install
button followed by an optional Review disclosure. Descriptions that advertise
another application are replaced in the presentation layer; registry records,
author credits, source code notices and compatibility identities are retained.
Native manifests can declare an optional HTTPS `icon` URL.

Replace imported sources one at a time with implementations of the Vestra SDK;
renaming or wrapping a compatibility script does not count as a native provider.
For each source, verify search, title identification, details, episodes or chapters,
artwork, headers, playback or reading, cancellation and failure states. Design a
mapping for existing saved titles and progress before switching users. Only retire
the corresponding compatibility import after the replacement passes these flows.
No provider is removed automatically by the gallery update.

The next UI module is Films. Native provider replacements remain tracked separately
in the roadmap and are not claimed complete by this presentation change.
