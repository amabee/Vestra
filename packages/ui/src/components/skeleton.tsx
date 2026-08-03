import type * as React from "react";

import { cn } from "../lib/cn";

/** Shimmering placeholder used while data loads. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl bg-secondary/60",
        "after:absolute after:inset-0 after:animate-shimmer",
        "after:bg-[linear-gradient(90deg,transparent,theme(colors.white/6%),transparent)]",
        "after:bg-[length:200%_100%]",
        className,
      )}
      {...props}
    />
  );
}

/** Poster-shaped skeleton matching MediaCard's 2:3 aspect ratio. */
export function MediaCardSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="aspect-[2/3] w-full rounded-2xl" />
      <Skeleton className="h-3.5 w-4/5" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

export function RowSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: count }, (_, index) => (
        <MediaCardSkeleton key={index} />
      ))}
    </div>
  );
}
