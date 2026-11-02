/** Explicit provider repairs, applied after transpilation. Never eval page scripts. */
export type ProviderCompatibility = "animesaturn-nested-player-v1";
export function chooseEpisodeServer(
  servers: string[],
  preferred?: string,
): string {
  if (preferred && !servers.includes(preferred))
    throw new Error(`Configured episode server is unavailable: ${preferred}`);
  return preferred ?? servers[0] ?? "default";
}
export function applyProviderCompatibility(
  source: string,
  profile?: ProviderCompatibility,
  identity?: { id: string; hosts: readonly string[] },
): string {
  // Repair this installed legacy adapter without rewriting the user's source or permissions.
  if (
    identity?.id === "shonen" &&
    identity.hosts.includes("shonen.to") &&
    /this\.sourceBase\s*=.*sources\/shonen/.test(source)
  )
    source += "\n" + shonenMediaRepair;
  if (!profile) return source;
  if (profile !== "animesaturn-nested-player-v1")
    throw new Error("Unknown provider compatibility profile.");
  return source + "\n" + nestedPlayerRepair;
}
const nestedPlayerRepair = String.raw`
Provider.prototype.findEpisodeServer = async function(episode, server) {
  const response = await fetch(episode.url, {headers:this.defaultHeaders});
  if(!response.ok)throw new Error('Episode HTTP '+response.status);
  const episodeDoc=LoadDoc(await response.text());
  const embed=episodeDoc('#pembed iframe').attr('src');
  if(!embed)throw new Error('Episode has no player iframe');
  let current=new URL(embed,episode.url).href;
  const visited=new Set();
  for(let depth=0;depth<3;depth++) {
    if(visited.has(current))throw new Error('Player iframe cycle');
    visited.add(current);
    const page=await fetch(current,{headers:{...this.defaultHeaders,Referer:episode.url}});
    if(!page.ok)throw new Error('Player HTTP '+page.status);
    const html=await page.text();
    // Only static string literals; dynamic scripts and obfuscated code remain unsupported.
    const match=html.match(/\b(?:var|let|const)\s+primary\s*=\s*["'](https?:[^"']+)["']/)
      || html.match(/["']?file["']?\s*:\s*["'](https?:[^"']+)["']/);
    if(match) {
      const url=new URL(match[1].replace(/\\\//g,'/').replace(/\\u0026/g,'&'),current).href;
      const type=new URL(url).pathname.toLowerCase().endsWith('.m3u8')?'m3u8':'mp4';
      return {server:server==='default'?'Server 1':server,headers:{Referer:current},videoSources:[{url,type,quality:'auto',subtitles:[]}]};
    }
    const frame=LoadDoc(html)('iframe').first().attr('src');
    if(!frame)throw new Error('Player contains no static video source or iframe');
    current=new URL(frame,current).href;
  }
  throw new Error('Player iframe depth exceeds 3');
};
`;

/** Shonen now advertises same-origin signed proxy links alongside absolute CDN URLs. */
const shonenMediaRepair = String.raw`
Provider.prototype.findEpisodeServer = async function(episode, server) {
  const parts = String(episode && episode.id || "").split("|");
  const animeId = parts[0], episodeNumber = parts[1];
  if (!/^\d+$/.test(animeId || "") || !/^\d+(?:\.\d+)?$/.test(episodeNumber || ""))
    throw new Error("Invalid Shonen episode identifier.");
  if (/dub/i.test(String(server || ""))) throw new Error("Shonen supports subtitles only.");
  const base = "https://shonen.to";
  const endpoint = new URL("/sources/shonen", base);
  endpoint.searchParams.set("id", animeId);
  endpoint.searchParams.set("episode", episodeNumber);
  endpoint.searchParams.set("language", "sub");
  const response = await fetch(endpoint.href, { headers: {
    Accept: "application/json", Referer: base + "/watch/" + animeId + "/" + episodeNumber
  }});
  if (!response.ok) throw new Error("Shonen source request failed (HTTP " + response.status + ")");
  const payload = await response.json();
  const data = payload && payload.data;
  if (!data || data.provider !== "shonen") throw new Error("Unexpected Shonen source response.");
  const absolute = value => {
    if (typeof value !== "string" || !value.trim()) return null;
    try { const url = new URL(value, base); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null; }
    catch { return null; }
  };
  const headers = { Referer: base + "/" };
  const sources = Array.isArray(data.sources) ? data.sources : [];
  const primary = absolute(data.source);
  const rows = primary ? [{ ...(sources.find(row => absolute(row && row.file) === primary) || {}), file: primary }, ...sources] : sources;
  const seen = new Set();
  const videoSources = [];
  for (const row of rows) {
    const url = absolute(row && row.file);
    if (!url || seen.has(url)) continue;
    const pathname = new URL(url).pathname;
    const hint = String(row.type || "").toLowerCase();
    const type = /\.mp4$/i.test(pathname) || hint === "mp4" ? "mp4" :
      /\.m3u8$/i.test(pathname) || /^(?:hls|m3u8)$/.test(hint) || /\/(?:media\/|api\/v1\/zoko-media|api\/stream\/proxy)/.test(pathname) ? "m3u8" : null;
    if (!type) continue;
    seen.add(url);
    const tracks = Array.isArray(row.tracks) ? row.tracks : url === primary && Array.isArray(data.tracks) ? data.tracks : [];
    const trackUrls = new Set();
    const subtitles = [];
    for (const track of tracks) {
      const file = absolute(track && track.file);
      if (!file || track.kind !== "subtitles" || trackUrls.has(file)) continue;
      trackUrls.add(file);
      subtitles.push({ id: "shonen-sub-" + subtitles.length, url: file, language: track.language || track.label || "Unknown", isDefault: track.default === true });
    }
    videoSources.push({ url, type, quality: "Auto", label: "Sub · Auto", headers, subtitles });
  }
  if (!videoSources.length) throw new Error("Shonen did not provide a playable stream for this episode.");
  return { server: "Sub", headers, videoSources };
};
`;
