const KEY = "vestra-anime-source";
/** The URL is authoritative; this is only the fallback for a fresh navigation. */
export function preferredAnimeSource(
  sources: readonly { id: string }[] | undefined,
  hasLocal = false,
): string {
  let remembered: string | null = null;
  try {
    remembered = localStorage.getItem(KEY);
  } catch {
    /* Storage can be unavailable in embedded previews. */
  }
  return (
    sources?.find((source) => source.id === remembered)?.id ??
    (remembered === "local" && hasLocal
      ? "local"
      : (sources?.[0]?.id ?? (hasLocal ? "local" : "")))
  );
}
export function rememberAnimeSource(id: string): void {
  try {
    if (id) localStorage.setItem(KEY, id);
  } catch {
    /* URL navigation still works without persistence. */
  }
}
