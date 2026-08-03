import { Button, EmptyState } from "@vestra/ui";
import { Compass } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl py-16">
      <EmptyState
        icon={<Compass className="size-5" />}
        title="Page not found"
        description="That page doesn't exist, or the media could not be loaded."
        action={
          <Button asChild variant="glass" size="sm">
            <Link href="/">Back to Home</Link>
          </Button>
        }
      />
    </div>
  );
}
