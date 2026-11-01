# Manifest reference

`manifest.json` lives beside the JavaScript entry file. New extensions use Vestra's
native SDK rather than a compatibility-script manifest.

## Identity and entry file

| Field        | Meaning                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| `id`         | Stable identifier, up to 100 letters, digits, dots, dashes or underscores.                                   |
| `name`       | Display name, up to 120 characters.                                                                          |
| `version`    | Your release version.                                                                                        |
| `sdkVersion` | Contract version. Movies/TV sources use `1.3.0`; anime discovery uses `1.2.0`; manga needs at least `1.1.0`. |
| `main`       | Relative JavaScript entry file inside the extension folder.                                                  |
| `role`       | `metadata` (default), `stream-source`, or `manga-source`.                                                    |
| `kinds`      | Catalogue media kinds. Anime streams use `["anime"]`; manga omits it.                                        |

## Permissions

`permissions` may contain `network`, `library:read` and `progress:read`. Network
requests also need explicit bare hostnames in `hosts`. Undeclared hosts and
subdomains do not inherit grants. Network without hosts is not a valid manifest.

The review determines what is granted; asking is not receiving. A host method
for an ungranted capability is absent.

## Presentation

| Field                  | Meaning                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `author`               | Author credit.                                                                                                |
| `description`          | Source description, up to 2,000 characters.                                                                   |
| `homepage`             | Project URL.                                                                                                  |
| `icon`                 | Optional HTTPS logo URL without embedded credentials.                                                         |
| `discovery.categories` | Optional feed names: suggested, ongoing, latest, upcoming, popular. Requires stream-source role and `browse`. |

## Versions and updates

Keep the ID stable between releases. A new ID is a new source identity. Increment
the release version when publishing code changes. SDK compatibility checks use
the major version; state the minimum minor version whose features you use.
