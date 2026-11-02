# Internet Archive classics

Browse and watch classic and archival feature films using the archive's public
APIs. This Movies-only extension needs no account, API key or additional server.
It uses archive item IDs and artwork directly, so TMDb configuration is optional
for this source.

## Install and watch

Open **Extensions → Available**, find **Internet Archive · Classics**, and click
**Install**. Review network access to `archive.org` and confirm. Open Movies,
browse or search a title, then choose Internet Archive among streaming sources.

The listing is part of the Vestra registry:
`https://raw.githubusercontent.com/amabee/Vestra/main/extensions/registry.json`.
Add that URL under Registries if you have not configured it. Registry entries
pin the manifest and code to an immutable commit. Developers can still load
`extensions/internet-archive` using **Choose extension folder**.

## What is included

The source searches the archive's `feature_films` collection. Popular reflects
archive download counts. Latest means recently added to the archive, which can
include films made many years ago. Artwork may be a film still rather than a
portrait poster. Editions and metadata come from each archive item.

This is a classics source, not a catalogue of current mainstream releases or TV
seasons. Different uploads of a film can be separate editions. Each item offers
one feature entry; multi-part assembly is not supported.

## Quality and availability

Public MP4 files play through Vestra's native player. Quality labels use the
archive's reported height; missing heights use Auto. Available small SRT/VTT
captions are included. Automatically generated captions are labelled and may
contain errors.

Restricted/dark items, private files and known previews are refused. Search may
still contain an unavailable item, so finding a title does not guarantee
playback. The extension does not sign in, borrow restricted items or bypass
access controls.

Live verification played **His Girl Friday (1940)** with video, audio and an
external caption. That sample exposed 480p and 240p files. Availability, artwork,
captions and delivery speed vary by item.
