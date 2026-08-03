import { localFileToMediaItem } from "@vestra/core/local-library";
import { getLocalFiles, getSettings } from "@vestra/storage";
import { EmptyState } from "@vestra/ui";
import { HardDrive } from "lucide-react";
import type { Metadata } from "next";

import { MediaGrid } from "@/components/media/media-grid";
import { getDriver } from "@/lib/storage";

export const metadata: Metadata = { title: "Local Library" };
export const dynamic = "force-dynamic";

export default async function LocalPage() {
  const driver = getDriver();
  const [files, settings] = await Promise.all([getLocalFiles(driver), getSettings(driver)]);

  return (
    <div className="space-y-6 pb-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Local Library</h1>
        <p className="text-sm text-muted-foreground">
          {files.length} file{files.length === 1 ? "" : "s"} across{" "}
          {settings.library.folders.length} folder
          {settings.library.folders.length === 1 ? "" : "s"}
        </p>
      </div>

      {files.length === 0 ? (
        <EmptyState
          icon={<HardDrive className="size-5" />}
          title="No local media yet"
          // Browsers cannot enumerate directories, so scanning is a desktop feature.
          description="Folder scanning runs in Vestra Nova, the desktop app. Once scanned, your files appear here and stay in sync."
        />
      ) : (
        <MediaGrid items={files.map(localFileToMediaItem)} />
      )}
    </div>
  );
}
