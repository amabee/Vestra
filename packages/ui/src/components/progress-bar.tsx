import { toPercent } from "@vestra/core/format";
import type * as React from "react";

import { cn } from "../lib/cn";

export interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0–1 fraction. */
  value: number;
  /** Violet → electric gradient instead of a flat fill. */
  gradient?: boolean;
}

export function ProgressBar({
  value,
  gradient = true,
  className,
  ...props
}: ProgressBarProps) {
  const percent = toPercent(value);

  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-secondary", className)}
      {...props}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          gradient ? "bg-gradient-to-r from-violet to-electric" : "bg-primary",
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
