import { useState } from "react";

/** Artwork is decorative; missing or broken logos keep a stable monogram. */
export function ExtensionArtwork({
  name,
  icon,
}: {
  name: string;
  icon?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  let url = "";
  try {
    const parsed = new URL(icon ?? "");
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password)
      url = parsed.href;
  } catch {
    // Registry artwork is optional and must never prevent installation.
  }
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join("")
    .toUpperCase();
  return (
    <div
      aria-hidden="true"
      className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-primary/15 bg-primary/10 text-xl font-semibold text-primary"
    >
      {url && failed !== url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="size-full object-contain p-2"
          onError={() => setFailed(url)}
        />
      ) : (
        initials || "V"
      )}
    </div>
  );
}

/** Present a useful category summary instead of another app's marketing copy.
 * Original registry metadata and author attribution remain unchanged. */
export function extensionDescription(
  description: string | undefined,
  type: string,
) {
  const text = description?.trim();
  if (text && !/seanime/i.test(text)) return text;
  if (type === "manga-provider")
    return "Discover manga and browse chapters from this source.";
  if (type === "onlinestream-provider")
    return "Search anime, browse episodes and choose a stream.";
  return "Extend your Vestra library with community tools and sources.";
}
