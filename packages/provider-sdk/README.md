# Vestra native provider SDK

Native providers export `activate({ host })` and return the methods for their manifest role. The application executes their standalone JavaScript inside QuickJS; there is no Node, browser cookie jar or filesystem access.

## SDK 1.7 source networking

- `network` allows bounded GET/POST requests to the exact HTTPS hosts approved for that extension.
- `network:session` additionally allows extension-supplied source session headers such as Referer, Origin and Authorization. It does not provide browser cookies.
- `network:cookies` separately permits an extension to send its own Cookie header to approved hosts. It requires `network` and a separate permission review. It cannot read the user's browser or account cookies.

The application follows at most five redirects within the extension's approved hosts. Every hop checks public DNS, HTTPS, standard ports and credentials. Cookies and Authorization are stripped when the origin changes. Ordinary host downloads, registries and unscoped fetches still reject redirects.

Network and invocation deadlines remain bounded. A pending host operation cannot retain an unloaded QuickJS isolate or run guest code after it is disposed.

Foundry holds native source implementations and immutable registry payloads: https://github.com/amabee/Foundry. The anime collection requires these host runtime changes; the v0.2.7 installer predates them.
