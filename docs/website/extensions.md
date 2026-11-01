# Install an extension

Extensions are optional. Each extension runs with the permissions and host grants
you approve.

## Choose a folder

In Extensions, choose **Choose extension folder** and select a directory containing
`manifest.json` and its JavaScript entry file. Review permissions and install.
Vestra stores a copy. Choose the folder again after editing source code.

## Paste a manifest link

Paste an HTTPS manifest URL into **Add an extension**. The installer detects its
format, resolves the entry file and opens the review. A registry is not required.

## Browse a registry

Add a registry URL under Registries, then open Browse. Cards show the name, version,
description and artwork where supplied. Review expands listing details; Install
opens the actual manifest and permissions review.

A registry listing does not guarantee upstream availability. An extension without
a usable manifest cannot be installed from its listing.

## Native or compatibility

Native extensions use Vestra's `sdkVersion` and `activate` contract. Existing provider
scripts use the optional Compatibility importer. Both keep their identities and
settings. Importing a compatibility script does not convert it into a native extension.

## Manage an installed source

Use Installed for native extensions and Compatibility for imported scripts.
Disabling a source removes it from selection. Replacement and update flows preserve
its identity; use those instead of inventing a new ID.
