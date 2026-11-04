# AnimeAV1

Native source adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal. See anime-ports.json, THIRD_PARTY_NOTICES.md and licenses/seanime-providers-MIT.txt. Supports the upstream HLS, UPNShare, Byse, Voe and MP4Upload mirrors. Audio categories stay separate; unavailable dub is never silently replaced with sub.

Public client metadata decoding is bundled locally; no downloaded JavaScript is executed. AES uses noble-ciphers (MIT) and authenticates GCM tags. See licenses/noble-ciphers-MIT.txt. Only reviewed extraction hosts receive network grants.
