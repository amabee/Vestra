// Check that a season resolves to the right MyAnimeList entry, and what
// timings come back for it.
//
//   node .tools/skip-check.mjs 146850 2 1
//   node .tools/skip-check.mjs <anilistId> <season> <episode>
//
// The library matches folders to whichever AniList entry the scanner found,
// which is often a series' first season even when the files are a later one.
// This shows which entry a lookup actually lands on.

const [anilistId, season = "1", episode = "1"] = process.argv.slice(2);

if (!anilistId) {
  console.error("usage: node skip-check.mjs <anilistId> [season] [episode]");
  process.exit(1);
}

const QUERY = `query($id:Int!){
  Media(id:$id, type:ANIME){
    id idMal title{romaji} seasonYear
    relations { edges { relationType node { id idMal title{romaji} format type } } }
  }
}`;

async function media(id) {
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { id } }),
  });
  const payload = await response.json();
  return payload.data?.Media ?? null;
}

const TV = new Set(["TV", "TV_SHORT"]);

const related = (node, type) =>
  (node.relations?.edges ?? [])
    .filter(
      (edge) =>
        edge.relationType === type &&
        edge.node.type === "ANIME" &&
        (!edge.node.format || TV.has(edge.node.format)),
    )
    .map((edge) => edge.node)[0];

let current = await media(Number(anilistId));
if (!current) {
  console.error("AniList returned nothing for that id.");
  process.exit(1);
}

console.log(`matched entry: ${current.title.romaji} (${current.seasonYear})`);
console.log(`               anilist=${current.id} mal=${current.idMal}\n`);

// Back to the first season, then forward to the one asked for.
const seen = new Set([current.id]);

for (let hop = 0; hop < 12; hop += 1) {
  const prequel = related(current, "PREQUEL");
  if (!prequel || seen.has(prequel.id)) break;
  current = await media(prequel.id);
  seen.add(current.id);
  console.log(`  <- prequel: ${current.title.romaji} (anilist=${current.id})`);
}

for (let step = 1; step < Number(season); step += 1) {
  const sequel = related(current, "SEQUEL");
  if (!sequel || seen.has(sequel.id)) {
    console.log(`\nno season ${season}: the chain stops at ${current.title.romaji}`);
    process.exit(0);
  }
  current = await media(sequel.id);
  seen.add(current.id);
  console.log(`  -> sequel:  ${current.title.romaji} (anilist=${current.id})`);
}

console.log(`\nseason ${season} resolves to:`);
console.log(`  ${current.title.romaji} (${current.seasonYear})`);
console.log(`  anilist=${current.id} mal=${current.idMal}\n`);

const url = `https://api.aniskip.com/v2/skip-times/${current.idMal}/${episode}?types=op&types=ed&episodeLength=0`;
const response = await fetch(url, { headers: { Accept: "application/json" } });

if (!response.ok) {
  console.log(`aniskip: HTTP ${response.status} (no timings for episode ${episode})`);
  process.exit(0);
}

const data = await response.json();
console.log(`aniskip episode ${episode}: found=${data.found}`);

for (const result of data.results ?? []) {
  const { startTime, endTime } = result.interval;
  console.log(
    `  ${result.skipType}: ${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s`,
  );
}
