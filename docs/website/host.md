# Host API

`activate({ host, manifest })` receives the context. Native extension code has no
global browser fetch, Node.js module resolver, DOM or filesystem.

## host.fetch

Available only when network access is granted:

```js
const response = await host.fetch({
  url: "https://api.your-domain.com/titles",
  headers: { accept: "application/json" },
});
if (response.status !== 200) throw new Error("Title request failed.");
const data = JSON.parse(response.body);
```

Requests accept `url`, optional `method`, `headers` and string `body`. Responses
contain `status`, `headers` and a body string. Use `JSON.parse(response.body)`;
this is not a browser Response with `.json()` or `.text()` methods.

Requests are host-brokered, bounded and rate limited. Declare each exact API host
and obtain its grant. Private and loopback destinations are unsupported. Loading
a local folder does not create a local HTTP API permission.

SDK 1.4 adds the opt-in `network:session` permission alongside `network`. It
allows extension-provided `Authorization`, `Referer`, `Origin`, `X-Client-Info`,
`X-Request-Lang` and `X-Source` headers to the same approved hosts. It also accepts
`X-Vip-Restrict: 1` to enforce source restrictions; other values are rejected.
Cookie and Host remain blocked. Header values are bounded and reject control
characters. No browser cookies or signed-in browser sessions are exposed.
Keep source-issued guest credentials in memory and out of logs.

## host.log

`host.log(level, message)` is always available. Levels are `debug`, `info`, `warn`
and `error`. Messages carry your extension ID. Log useful context without signed
stream URLs, access tokens or private user data.

## Read capabilities

The SDK defines `host.readLibrary()` and `host.readProgress()` for their respective
read permissions. Desktop relaying is limited; do not make source search depend
on them. The host owns progress writes and saved lists.

## Capability checks

Check `typeof host.fetch === "function"` before using a required network
capability. Throw a clear activation error when the user declined a permission
the source needs. Silent empty results hide missing permissions.

## Runtime limits

Bundle dependencies into one compatible JavaScript entry. Do not depend on Node
modules, browser globals, timers or a DOM parser appearing by accident. Only
JSON-compatible results cross the boundary. CPU, memory and request deadlines
protect the app from hanging sources or huge responses.
