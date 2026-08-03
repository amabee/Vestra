"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LocalFolder } from "@vestra/types";
import { Button, GlassCard } from "@vestra/ui";
import { FolderOpen, LoaderCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { toast } from "@/components/ui/toaster";

interface ScanSummary {
  scanned: number;
  added: number;
  removed: number;
  matched: number;
  unmatched: number;
  errors: string[];
}

/**
 * Media folder management and library scanning.
 *
 * Scanning is what makes catalogue entries playable: files are indexed, then
 * matched to AniList/TMDb so "Play" on a title resolves to the user's own copy.
 */
export function LibraryPanel() {
  const queryClient = useQueryClient();
  const [folderPath, setFolderPath] = useState("");
  const [summary, setSummary] = useState<ScanSummary | null>(null);

  const { data } = useQuery({
    queryKey: ["library-folders"],
    queryFn: async () => {
      const response = await fetch("/api/library/folders");
      if (!response.ok) throw new Error("Could not load folders");
      return (await response.json()) as { folders: LocalFolder[] };
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["library-folders"] });

  const addFolder = useMutation({
    mutationFn: async (value: string) => {
      const response = await fetch("/api/library/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: value, label: null }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not add folder");
    },
    onSuccess: () => {
      setFolderPath("");
      toast("Folder added — run a scan to index it");
      void invalidate();
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  const removeFolder = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch("/api/library/folders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error("Could not remove folder");
    },
    onSuccess: () => {
      toast("Folder removed");
      void invalidate();
    },
    onError: () => toast("Could not remove folder", "error"),
  });

  const scan = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/library/scan", { method: "POST" });
      const payload = (await response.json()) as ScanSummary & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Scan failed");
      return payload;
    },
    onSuccess: (result) => {
      setSummary(result);
      toast(`Indexed ${result.scanned} file${result.scanned === 1 ? "" : "s"}`);
      void invalidate();
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  const folders = data?.folders ?? [];

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Media folders</h2>
        <p className="text-xs text-muted-foreground">
          Vestra indexes video files in these folders and matches them to AniList and
          TMDb, so pressing Play on a title plays your own copy.
        </p>
      </div>

      <GlassCard className="space-y-4 p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (folderPath.trim()) addFolder.mutate(folderPath.trim());
          }}
          className="flex gap-2"
        >
          <input
            value={folderPath}
            onChange={(event) => setFolderPath(event.target.value)}
            placeholder="C:\Users\you\Videos\Anime"
            spellCheck={false}
            className="h-9 flex-1 rounded-lg border border-border bg-secondary/40 px-3 text-[13px] outline-none transition-colors focus:border-primary/50"
          />
          <Button
            type="submit"
            size="sm"
            disabled={addFolder.isPending || folderPath.trim().length === 0}
          >
            {addFolder.isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Add
          </Button>
        </form>

        {folders.length === 0 ? (
          <p className="flex items-center gap-2 rounded-lg bg-secondary/40 px-3 py-2.5 text-xs text-muted-foreground">
            <FolderOpen className="size-4 shrink-0" />
            No folders yet. Paste an absolute path above.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {folders.map((folder) => (
              <li
                key={folder.id}
                className="flex items-center gap-3 rounded-lg bg-secondary/40 px-3 py-2"
              >
                <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                  {folder.path}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${folder.path}`}
                  onClick={() => removeFolder.mutate(folder.id)}
                  disabled={removeFolder.isPending}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-3 border-t border-glass-border pt-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => scan.mutate()}
            disabled={scan.isPending || folders.length === 0}
          >
            {scan.isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {scan.isPending ? "Scanning…" : "Scan library"}
          </Button>

          {summary ? (
            <p className="text-xs text-muted-foreground">
              {summary.scanned} file{summary.scanned === 1 ? "" : "s"} · {summary.added} new
              · {summary.matched} matched
              {summary.unmatched > 0 ? ` · ${summary.unmatched} unmatched` : ""}
            </p>
          ) : null}
        </div>

        {summary?.errors.length ? (
          <ul className="space-y-1 text-[11px] text-amber-400">
            {summary.errors.slice(0, 5).map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}
      </GlassCard>
    </section>
  );
}
