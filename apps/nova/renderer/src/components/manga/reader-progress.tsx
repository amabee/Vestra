import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { hoverPage, type ReaderImages } from "@/lib/reader-images";
import type { MangaPage } from "../../../../shared/manga";

export function ReaderProgress({
  pages,
  page,
  images,
  onChange,
}: {
  pages: MangaPage[];
  page: number;
  images: ReaderImages;
  onChange: (page: number) => void;
}) {
  const [hover, setHover] = useState<{ page: number; x: number } | null>(null);
  const [preview, setPreview] = useState<typeof hover>(null);
  useEffect(() => {
    const timer = setTimeout(() => setPreview(hover), 100);
    if (!hover) setPreview(null);
    return () => clearTimeout(timer);
  }, [hover]);
  return (
    <div
      className="relative mb-2 flex h-5 items-center"
      onPointerLeave={() => setHover(null)}
    >
      {hover && (
        <div
          role="tooltip"
          aria-label={`Preview page ${hover.page + 1}`}
          className="pointer-events-none absolute bottom-full z-50 mb-3 w-36 -translate-x-1/2 rounded-xl border border-white/15 bg-neutral-900 p-2 text-center shadow-2xl"
          style={{ left: hover.x }}
        >
          {preview?.page === hover.page ? (
            <PagePreview
              key={pages[preview.page]!.handle}
              handle={pages[preview.page]!.handle}
              images={images}
              page={preview.page}
            />
          ) : (
            <div className="flex h-40 items-center justify-center text-xs text-neutral-400">
              Loading preview…
            </div>
          )}
          <span className="mt-1 block text-xs tabular-nums">
            Page {hover.page + 1}
          </span>
        </div>
      )}
      <input
        className="range range-xs block w-full"
        aria-label="Reading progress"
        aria-valuetext={`Page ${page + 1} of ${pages.length}`}
        type="range"
        min={1}
        max={pages.length}
        value={page + 1}
        onPointerMove={(event) => {
          if (event.pointerType === "touch") return;
          const rect = event.currentTarget.getBoundingClientRect();
          setHover({
            page: hoverPage(event.clientX, rect.left, rect.width, pages.length),
            x:
              rect.width < 160
                ? rect.width / 2
                : Math.max(
                    76,
                    Math.min(rect.width - 76, event.clientX - rect.left),
                  ),
          });
        }}
        onBlur={() => setHover(null)}
        onChange={(event) => {
          const next = Number(event.target.value) - 1;
          onChange(next);
          if (hover) setHover({ ...hover, page: next });
        }}
      />
    </div>
  );
}

function PagePreview({
  handle,
  images,
  page,
}: {
  handle: string;
  images: ReaderImages;
  page: number;
}) {
  const image = useQuery({
    queryKey: ["manga-preview", handle],
    queryFn: () => images.preview(handle),
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
  });
  const [failed, setFailed] = useState(false);
  if (image.error || failed)
    return (
      <div className="flex h-40 items-center justify-center text-xs text-neutral-400">
        Preview unavailable
      </div>
    );
  if (!image.data)
    return (
      <div className="flex h-40 items-center justify-center text-xs text-neutral-400">
        Loading preview…
      </div>
    );
  return (
    <img
      src={image.data}
      alt={`Preview of page ${page + 1}`}
      className="h-40 w-full object-contain"
      onError={() => setFailed(true)}
    />
  );
}
