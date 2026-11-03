const KEY = "vestra-manga-sources-v1";
type Choice = { catalogue: number; source: string };
function choices(): Choice[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value)
      ? value
          .filter(
            (row): row is Choice =>
              !!row &&
              typeof row === "object" &&
              Number.isSafeInteger(row.catalogue) &&
              row.catalogue > 0 &&
              typeof row.source === "string" &&
              row.source.length <= 120,
          )
          .slice(-500)
      : [];
  } catch {
    return [];
  }
}
export function preferredMangaSource(
  catalogue: number,
  enabled: readonly { id: string }[],
) {
  const saved = choices().find((row) => row.catalogue === catalogue)?.source;
  return (
    enabled.find((row) => row.id === saved)?.id ??
    (enabled.length === 1 ? enabled[0]!.id : "")
  );
}
export function rememberMangaSource(catalogue: number, source: string) {
  if (
    !Number.isSafeInteger(catalogue) ||
    catalogue <= 0 ||
    !source ||
    source.length > 120
  )
    return;
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify(
        [
          ...choices().filter((row) => row.catalogue !== catalogue),
          { catalogue, source },
        ].slice(-500),
      ),
    );
  } catch {
    /* The current reading choice still works without persistence. */
  }
}
