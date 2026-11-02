import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { screenPosterUrl } from "./screen-artwork";
import { Film } from "lucide-react";
import type { MediaItem } from "@vestra/types";

// Reuse loaded image nodes when virtual rows return, including hosts that disable
// HTTP caching. Keep only idle nodes here; visible nodes belong to their cards.
const idle: { url: string; image: HTMLImageElement; bytes: number }[] = [];
let idleBytes = 0;
function acquire(url: string) {
  const index = idle.findIndex((entry) => entry.url === url);
  if (index >= 0) {
    const [entry] = idle.splice(index, 1);
    idleBytes -= entry!.bytes;
    return entry!.image;
  }
  const image = new Image();
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  image.src = url;
  return image;
}
function release(url: string, image: HTMLImageElement) {
  image.onload = null;
  image.onerror = null;
  image.remove();
  if (!image.complete || !image.naturalWidth) return;
  const bytes = image.naturalWidth * image.naturalHeight * 4;
  if (bytes > 32 * 1024 * 1024) return;
  idle.push({ url, image, bytes });
  idleBytes += bytes;
  while (idle.length > 128 || idleBytes > 32 * 1024 * 1024)
    idleBytes -= idle.shift()!.bytes;
}
export function ScreenPoster({ item }: { item: MediaItem }) {
  const host = useRef<HTMLSpanElement>(null);
  const url = screenPosterUrl(item.images.poster);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  useLayoutEffect(() => {
    const element = host.current;
    if (!url || failed || !element) return;
    const image = acquire(url);
    image.onerror = () => setFailed(true);
    element.appendChild(image);
    return () => release(url, image);
  }, [url, failed]);
  return url && !failed ? (
    <span className="screen-poster-image" ref={host} />
  ) : (
    <span className="hub-poster-fallback">
      <Film aria-hidden="true" />
      <span>Artwork unavailable</span>
    </span>
  );
}
