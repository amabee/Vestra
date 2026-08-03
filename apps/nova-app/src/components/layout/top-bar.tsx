"use client";

import { cn } from "@vestra/ui/cn";
import { Bell, ChevronDown, Search } from "lucide-react";
import Link from "next/link";

import { useUiStore } from "@/stores/ui-store";

/** Full-width application bar: brand, global search, account actions. */
export function TopBar() {
  const setSearchOpen = useUiStore((state) => state.setSearchOpen);
  const collapsed = useUiStore((state) => state.sidebarCollapsed);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 flex h-16 shrink-0 items-center gap-4 border-b border-border/60",
        "bg-background/80 px-4 backdrop-blur-xl",
        // Draggable region for Nova's frameless window; inert in the browser.
        "drag-region",
      )}
    >
      {/* Brand — width tracks the sidebar so the columns line up. */}
      <Link
        href="/"
        className={cn(
          "no-drag flex shrink-0 items-center gap-2.5 transition-[width] duration-200",
          collapsed ? "w-12" : "w-52",
        )}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet to-electric text-sm font-black text-white shadow-glow-violet">
          V
        </span>
        {!collapsed && (
          <span className="text-[15px] font-bold tracking-[0.18em]">VESTRA</span>
        )}
      </Link>

      {/* Global search — centred, capped so it stays a focal point. */}
      <div className="flex flex-1 justify-center">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className={cn(
            "no-drag group flex h-9 w-full max-w-md items-center gap-2.5 rounded-lg px-3",
            "border border-border bg-secondary/50 text-left text-[13px] text-muted-foreground",
            "transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
            "hover:border-primary/40 hover:bg-secondary/80",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <Search className="size-3.5 shrink-0 transition-colors group-hover:text-violet-soft" />
          <span className="flex-1 truncate">Search anime, movies, k-drama, youtube...</span>
          <kbd className="hidden shrink-0 rounded border border-border bg-background/60 px-1.5 py-0.5 font-mono text-[10px] sm:inline-block">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Account actions */}
      <div className="no-drag flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label="Notifications"
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bell className="size-4" />
        </button>

        <button
          type="button"
          aria-label="Account"
          className="flex items-center gap-1.5 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-violet to-electric text-[11px] font-bold text-white">
            J
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </div>
    </header>
  );
}
