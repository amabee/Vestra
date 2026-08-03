import { Skeleton } from "@vestra/ui";

/** Mirrors the Home layout: hero, then three card rows. */
function RowSkeletonBlock({ landscape = false }: { landscape?: boolean }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <Skeleton className="h-5 w-40" />
        <div className="flex-1" />
        <Skeleton className="size-7 rounded-md" />
        <Skeleton className="size-7 rounded-md" />
      </div>

      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: landscape ? 5 : 9 }, (_, index) => (
          <div
            key={index}
            className={landscape ? "w-[248px] shrink-0" : "w-[132px] shrink-0"}
          >
            <Skeleton
              className={landscape ? "aspect-video rounded-xl" : "aspect-2/3 rounded-xl"}
            />
            <Skeleton className="mt-2 h-3 w-4/5" />
            <Skeleton className="mt-1.5 h-2.5 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="space-y-7 pb-8">
      <Skeleton className="-mx-6 -mt-5 h-[340px] rounded-none" />
      <RowSkeletonBlock landscape />
      <RowSkeletonBlock />
      <RowSkeletonBlock />
    </div>
  );
}
