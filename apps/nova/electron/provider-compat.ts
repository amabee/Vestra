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
): string {
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
