import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS } from "@vestra/types";
import { useSettings } from "@/lib/queries";
import { mediaBannerPresentation } from "../../../../shared/media-appearance";
export function MediaBanner({
  backdrop,
  fallback,
  className = "",
  onError,
}: {
  backdrop?: string | null;
  fallback?: string | null;
  className?: string;
  onError?: (url: string) => void;
}) {
  const { data: settings } = useSettings();
  const appearance = settings?.appearance ?? DEFAULT_SETTINGS.appearance;
  const [failed, setFailed] = useState<string[]>([]);
  useEffect(() => setFailed([]), [backdrop, fallback]);
  const available = !!backdrop && !failed.includes(backdrop);
  const image = available
    ? backdrop
    : fallback && !failed.includes(fallback)
      ? fallback
      : null;
  const mode = mediaBannerPresentation(appearance, available);
  if (mode.hidden) return null;
  return (
    <div
      className={`media-banner-art ${mode.blurred ? "is-blurred" : ""} ${mode.dimmed ? "is-dimmed" : ""} ${className}`}
      data-size={mode.size}
      data-has-backdrop={available}
      aria-hidden="true"
    >
      {image && (
        <img
          src={image}
          alt=""
          referrerPolicy="no-referrer"
          decoding="async"
          style={{
            opacity: appearance.bannerOpacity * (mode.dimmed ? 0.25 : 1),
            objectPosition: appearance.bannerPosition,
          }}
          onError={() => {
            setFailed((v) => [...v, image]);
            onError?.(image);
          }}
        />
      )}
    </div>
  );
}
export function MediaPageBackground({ image }: { image?: string | null }) {
  const { data: settings } = useSettings();
  if (
    !image ||
    !settings?.appearance.glassEffects ||
    !settings.appearance.mediaBlurredBackground
  )
    return null;
  return (
    <img
      className="media-page-backdrop"
      src={image}
      alt=""
      aria-hidden="true"
      referrerPolicy="no-referrer"
    />
  );
}
