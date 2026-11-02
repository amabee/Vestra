# Vyla service connector

Vyla is an optional **self-hosted API connection**, disabled by default. It is
not a public streaming endpoint or an extension to install from the registry.
You operate the service; Vestra connects to its HTTP/SSE playback API.

## Configure

Follow [Vyla's hosting instructions](https://vyla.cc/stream-api/deployment/self-hosting.md)
to run your own deployment. Vestra does not download, install or start that server.
The service and its upstream providers have their own availability requirements.

Set the following variables in the shell that launches Nova:

```powershell
# Your locally running service, or your public HTTPS deployment:
$env:VESTRA_VYLA_URL = 'http://127.0.0.1:7860'
# Vestra's existing catalogue configuration:
$env:TMDB_ACCESS_TOKEN = 'YOUR_TMDB_READ_ACCESS_TOKEN'
pnpm --filter @vestra/nova build
pnpm --filter @vestra/nova start
```

`TMDB_API_KEY` can be used instead of `TMDB_ACCESS_TOKEN`. Your server may require
its own TMDb configuration separately. If your reverse proxy uses bearer auth,
set `VESTRA_VYLA_TOKEN` in the same shell. Never put credentials in the URL.

The address can use `/api` as a prefix. Remote deployments require public HTTPS.
Local HTTP is limited to literal `127.0.0.1` or `[::1]`; `localhost`, arbitrary LAN
addresses, custom paths, URL credentials, queries/fragments and redirects are
not accepted. This connection does not widen extension sandbox permissions.

## Watch

With the address configured, **Vyla · self-hosted** appears alongside Movies/TV
sources, and in the title's streaming-source choices. Search, covers, details,
Popular and aired seasons reuse Vestra's existing TMDb catalogue. These are
catalogue candidates, not a source availability index: a title or episode can
still produce no playable result when you press Play.

The connector reads events incrementally, verifies media bytes and starts with
the first usable candidate. It cancels the remaining event stream at that point.
Mirror recovery requests again while excluding attempted source keys. It does
not collect all providers before returning video or maintain an accumulating
background mirror queue. There is a 15-second request ceiling.

## Media requirements

Media must be **public HTTPS HLS or MP4**, even when the API runs on loopback
HTTP. Keep upstream URLs direct when they work, or configure an HTTPS media
proxy. An `http://127.0.0.1:7860/api?...` media URL is rejected by the existing
native playback contract. The connector does not add an HTTP-stream exception,
follow embed players or replay arbitrary upstream cookies/headers. Sources that
need special delivery headers should be handled by your service's media proxy.
The service bearer token is used only for the API request; media and subtitle
URLs must work independently, for example through signed HTTPS proxy URLs.

Subtitles already supplied in the metadata event are attached when valid. No
separate subtitle/download API request delays playback. Quality is labelled Auto;
no resolution is inferred from a provider name or an embed's advertised quality.

## Verify and disable

`pnpm test:vyla` exercises the connector, including an actual loopback SSE fixture.
Those tests do not certify a live Vyla deployment or its upstreams. Live movie,
multi-season TV, audio/subtitle, seek/resume and expiry checks remain deployment
release gates.

Clear `VESTRA_VYLA_URL` and restart Nova to disable the connector. No installed
extension or library records are removed.
