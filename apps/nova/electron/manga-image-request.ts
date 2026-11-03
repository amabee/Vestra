/** Keep source headers authoritative and supply ordinary browser image negotiation. */
export function mangaImageHeaders(
  headers: Record<string, string> = {},
  userAgent?: string,
  referer?: string,
  negotiate = true,
): Record<string, string> {
  const result = { ...headers };
  const has = (key: string) =>
    Object.keys(result).some((name) => name.toLowerCase() === key);
  const add = (key: string, value: string) => {
    if (!has(key.toLowerCase()) && Object.keys(result).length < 32)
      result[key] = value;
  };
  if (userAgent) add("User-Agent", userAgent);
  if (referer && !has("referer")) {
    try {
      const url = new URL(referer);
      if (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        url.port === ""
      ) {
        url.hash = "";
        add("Referer", url.href);
      }
    } catch {
      /* Opaque source IDs are not referrers. */
    }
  }
  if (negotiate)
    add(
      "Accept",
      "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.5",
    );
  return result;
}
