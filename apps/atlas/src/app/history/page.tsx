import { formatRelativeTime } from "@vestra/core/format";
import { getHistory } from "@vestra/storage";
import { EmptyState, GlassCard } from "@vestra/ui";
import { History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { mediaHref } from "@/lib/routes";
import { getDriver } from "@/lib/storage";

export const metadata: Metadata = { title: "History" };
export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const entries = await getHistory(getDriver());

  return (
    <div className="space-y-6 pb-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">History</h1>
        <p className="text-sm text-muted-foreground">Everything you've watched, most recent first.</p>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon={<History className="size-5" />}
          title="No history yet"
          description="Once you start watching, your activity appears here. You can turn tracking off in Settings."
        />
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <Link key={entry.id} href={mediaHref(entry.ref)} className="block">
              <GlassCard className="flex items-center gap-4 p-3 transition-colors hover:bg-secondary/40">
                <div className="h-16 w-11 shrink-0 overflow-hidden rounded-lg bg-secondary">
                  {entry.snapshot.images.thumbnail ? (
                    <img
                      src={entry.snapshot.images.thumbnail}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : null}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{entry.snapshot.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatRelativeTime(entry.watchedAt)}
                    {entry.completed ? " · Completed" : ""}
                  </p>
                </div>
              </GlassCard>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
