"use client";

import { Button, EmptyState } from "@vestra/ui";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[atlas] route error", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl py-16">
      <EmptyState
        icon={<TriangleAlert className="size-5" />}
        title="Something went wrong"
        // `error.message` is safe to show: Next redacts server messages in production.
        description={error.message || "An unexpected error occurred."}
        action={
          <Button variant="glass" size="sm" onClick={reset}>
            <RefreshCw className="size-4" />
            Try again
          </Button>
        }
      />
    </div>
  );
}
