/** MovieBox's verified OSS CDN can serve a display-sized image before decoding. */
export function screenPosterUrl(value: string | null): string | null {
  if (!value) return value;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "pbcdnw.aoneroom.com" ||
      !url.pathname.startsWith("/image/") ||
      url.search
    )
      return value;
    url.searchParams.set(
      "x-oss-process",
      "image/resize,w_480,limit_1/quality,q_85/format,webp",
    );
    return url.href;
  } catch {
    return value;
  }
}
