"use client";

import type { MediaItem } from "@vestra/types";
import { MediaCard } from "@vestra/ui";
import { motion } from "motion/react";
import Link from "next/link";

import { mediaHref } from "@/lib/routes";

export interface MediaGridProps {
  items: readonly MediaItem[];
  /** Show the coloured kind chip under each card. */
  showBadge?: boolean;
}

/** Responsive poster grid used by category, search and watchlist pages. */
export function MediaGrid({ items, showBadge = true }: MediaGridProps) {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
      {items.map((item, index) => (
        <motion.div
          key={`${item.source}-${item.kind}-${item.sourceId}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          // Cap the stagger so large grids don't take seconds to finish.
          transition={{
            duration: 0.2,
            delay: Math.min(index * 0.02, 0.4),
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          <MediaCard
            item={item}
            href={mediaHref(item)}
            linkComponent={Link}
            showBadge={showBadge}
          />
        </motion.div>
      ))}
    </div>
  );
}
