/** Installed entries use validated manifests; catalogue entries advertise kinds/tags. */
export type CategorizedExtension = {
  type: string;
  kinds?: readonly string[];
  tags?: readonly string[];
  manifest?: { kinds?: readonly string[] };
};
export function extensionKinds(entry: CategorizedExtension): readonly string[] {
  if (entry.manifest?.kinds) return entry.manifest.kinds;
  if (entry.kinds?.length) return entry.kinds;
  const tags = new Set(entry.tags?.map((tag) => tag.toLowerCase()));
  return [
    ...(tags.has("movie") || tags.has("movies") ? ["movie"] : []),
    ...(tags.has("tv") || tags.has("series") ? ["tv"] : []),
  ];
}
export function matchesExtensionCategory(
  entry: CategorizedExtension,
  category: string,
): boolean {
  if (category === "all") return true;
  const kinds = extensionKinds(entry);
  if (category === "movie" || category === "tv")
    return kinds.includes(category);
  if (category === "other")
    return (
      !["onlinestream-provider", "manga-provider"].includes(entry.type) &&
      !kinds.some((k) => k === "movie" || k === "tv")
    );
  return entry.type === category;
}
