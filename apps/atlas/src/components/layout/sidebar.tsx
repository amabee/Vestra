"use client";

import { NAV_ITEMS, type NavItem } from "@vestra/config/navigation";
import { cn } from "@vestra/ui/cn";
import {
  Bookmark,
  ChevronDown,
  Clapperboard,
  Compass,
  Download,
  HardDrive,
  Heart,
  History,
  House,
  PanelLeft,
  Settings,
  Sparkles,
  Tv,
  Video,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useUiStore } from "@/stores/ui-store";

/**
 * NAV_ITEMS stores icon NAMES so @vestra/config stays framework-agnostic.
 * This map is the single place that binds those names to real components.
 */
const ICONS: Record<string, LucideIcon> = {
  House,
  Compass,
  Sparkles,
  Clapperboard,
  Tv,
  Heart,
  Video,
  HardDrive,
  Download,
  Bookmark,
  History,
  Settings,
};

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const pathname = usePathname();
  const Icon = ICONS[item.icon] ?? Compass;
  const active = isActive(pathname, item.href);

  return (
    <Link
      href={item.href}
      title={item.label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-lg py-2 text-[13px] font-medium",
        "transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-sidebar-accent text-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
        // Below lg the rail is icon-only regardless of the stored preference.
        collapsed ? "justify-center px-0" : "justify-center px-0 lg:justify-start lg:px-3",
      )}
    >
      <Icon
        className={cn(
          "size-[18px] shrink-0 transition-colors",
          active ? "text-violet-soft" : "text-muted-foreground group-hover:text-foreground",
        )}
      />
      <span className={cn("truncate", collapsed ? "hidden" : "hidden lg:inline")}>
        {item.label}
      </span>
    </Link>
  );
}

export function Sidebar() {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  const primary = NAV_ITEMS.filter((item) => item.section === "primary");
  const library = NAV_ITEMS.filter((item) => item.section === "library");
  const system = NAV_ITEMS.filter((item) => item.section === "system");

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar/60 px-2",
        "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
        collapsed ? "w-16" : "w-16 lg:w-56 lg:px-3",
      )}
    >
      <nav className="no-scrollbar flex flex-1 flex-col gap-4 overflow-y-auto py-3">
        <div className="flex flex-col gap-0.5">
          {primary.map((item) => (
            <SidebarLink key={item.id} item={item} collapsed={collapsed} />
          ))}
        </div>

        <div className="flex flex-col gap-0.5">
          {library.map((item) => (
            <SidebarLink key={item.id} item={item} collapsed={collapsed} />
          ))}
        </div>
      </nav>

      {/* Pinned footer: settings, collapse control and the account card. */}
      <div className="flex flex-col gap-0.5 border-t border-sidebar-border py-3">
        {system.map((item) => (
          <SidebarLink key={item.id} item={item} collapsed={collapsed} />
        ))}

        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "flex items-center gap-3 rounded-lg py-2 text-[13px] font-medium",
            "text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            collapsed ? "justify-center px-0" : "justify-center px-0 lg:justify-start lg:px-3",
          )}
        >
          <PanelLeft className="size-[18px] shrink-0" />
          <span className={cn(collapsed ? "hidden" : "hidden lg:inline")}>Collapse</span>
        </button>

        <button
          type="button"
          className={cn(
            "mt-2 flex items-center gap-2.5 rounded-lg p-2 transition-colors hover:bg-sidebar-accent/50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            collapsed ? "justify-center p-1" : "justify-center p-1 lg:justify-start lg:p-2",
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet to-electric text-[11px] font-bold text-white">
            J
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 items-center gap-2",
              collapsed ? "hidden" : "hidden lg:flex",
            )}
          >
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[13px] font-medium">johndoe</span>
              <span className="block truncate text-[11px] text-violet-soft">Premium</span>
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </span>
        </button>
      </div>
    </aside>
  );
}
