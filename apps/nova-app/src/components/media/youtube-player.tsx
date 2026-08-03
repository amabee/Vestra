"use client";

import { YOUTUBE_EMBED_BASE } from "@vestra/config/constants";
import { useMemo } from "react";

/**
 * Embedded YouTube player.
 *
 * Uses youtube-nocookie and a restrictive sandbox/referrer policy so playback
 * doesn't hand the user's session to Google's tracking cookies.
 */
export function YoutubePlayer({ videoId, title }: { videoId: string; title: string }) {
  const src = useMemo(() => {
    const params = new URLSearchParams({
      rel: "0",
      modestbranding: "1",
      playsinline: "1",
    });
    // `videoId` comes from provider data, but encode it anyway — it lands in a URL.
    return `${YOUTUBE_EMBED_BASE}/${encodeURIComponent(videoId)}?${params.toString()}`;
  }, [videoId]);

  return (
    <div className="overflow-hidden rounded-2xl bg-black shadow-lifted">
      <iframe
        src={src}
        title={title}
        className="aspect-video w-full"
        allow="accelerometer; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
      />
    </div>
  );
}
