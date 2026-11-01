export class RateLimited extends Error {
  constructor(readonly seconds: number) {
    super("Discovery is temporarily rate limited. Try again shortly.");
  }
}
export async function fetchCatalogueGraphQL(
  query: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 429)
    throw new RateLimited(
      Math.min(
        120,
        Math.max(10, Number(response.headers.get("Retry-After")) || 60),
      ),
    );
  if (!response.ok)
    throw new Error(`AniList catalogue returned HTTP ${response.status}.`);
  const text = await response.text();
  if (text.length > 2_097_152)
    throw new Error("Catalogue response exceeded its size limit.");
  const json = JSON.parse(text);
  if (json.errors?.length)
    throw new Error("AniList could not process this catalogue request.");
  return json.data;
}
