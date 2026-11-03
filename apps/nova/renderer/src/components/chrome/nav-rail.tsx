import { useEffect, useRef } from "react";
import { useSettings } from "@/lib/queries";
import { preloadDestination } from "@/lib/navigation-preload";
import { NavLink } from "react-router";
import {
  Download,
  Blocks,
  Clapperboard,
  Compass,
  House,
  CalendarDays,
  HardDrive,
  History,
  Bookmark,
  BookOpen,
  Settings,
  Sparkles,
  Tv,
} from "lucide-react";

/**
 * Navigation rail.
 *
 * A rail rather than a sidebar. Media apps traditionally hand a fixed 240px
 * to navigation the user reads once and then ignores; giving that width back
 * to the catalogue is most of what makes this feel different. Labels appear on
 * hover, so nothing is lost.
 */

const SECTIONS = [
  {
    label: "Browse",
    items: [
      { to: "/", label: "Home", icon: House },
      { to: "/discover", label: "Discover", icon: Compass },
      { to: "/schedule", label: "Schedule", icon: CalendarDays },
      { to: "/anime", label: "Anime", icon: Sparkles },
      { to: "/manga", label: "Manga", icon: BookOpen },
      { to: "/films", label: "Films", icon: Clapperboard },
      { to: "/series", label: "Series", icon: Tv },
    ],
  },
  {
    label: "Yours",
    items: [
      { to: "/downloads", label: "Downloads", icon: Download },
      { to: "/library", label: "Library", icon: HardDrive },
      { to: "/watchlist", label: "Watchlist", icon: Bookmark },
      { to: "/history", label: "History", icon: History },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/extensions", label: "Extensions", icon: Blocks },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
] as const;

export function NavRail() {
  const { data: settings } = useSettings();
  const unpinned = settings?.appearance.unpinnedMenuItems ?? [];
  return (
    <nav
      aria-label="Main navigation"
      className="nova-nav-rail flex w-14 shrink-0 flex-col items-center gap-6 border-r rule py-4"
    >
      {SECTIONS.map((section) => (
        <div key={section.label} className="flex flex-col items-center gap-1">
          {section.items
            .filter(
              (item) =>
                !unpinned.includes(item.to as (typeof unpinned)[number]),
            )
            .map((item) => (
              <RailLink key={item.to} {...item} />
            ))}
        </div>
      ))}
      {unpinned.length > 0 && (
        <details className="relative">
          <summary className="cursor-pointer px-2 py-1 text-xs">More</summary>
          <div className="absolute left-full bottom-0 z-30 grid gap-1 border rule bg-base-200 p-2 min-w-40">
            {SECTIONS.flatMap<{
              to: string;
              label: string;
              icon: typeof Compass;
            }>((s) => [...s.items])
              .filter((item) =>
                unpinned.includes(item.to as (typeof unpinned)[number]),
              )
              .map((item) => (
                <NavLink
                  className="px-2 py-1 text-sm hover:text-primary"
                  key={item.to}
                  to={item.to}
                >
                  {item.label}
                </NavLink>
              ))}
          </div>
        </details>
      )}
    </nav>
  );
}

function RailLink({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: typeof Compass;
}) {
  const { data: settings } = useSettings();
  const mode = settings?.appearance.navigationPreloading ?? "intent";
  const anchor = useRef<HTMLAnchorElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
  };
  const preload = () => {
    void preloadDestination(to).catch(() => undefined);
  };
  useEffect(() => {
    if (mode !== "viewport" || !anchor.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        preload();
        observer.disconnect();
      }
    });
    observer.observe(anchor.current);
    return () => observer.disconnect();
  }, [mode, to]);
  useEffect(() => cancel, [mode]);
  return (
    <NavLink
      ref={anchor}
      onMouseEnter={() => {
        if (mode === "intent" || mode === "faster-intent")
          timer.current = setTimeout(preload, mode === "intent" ? 180 : 40);
      }}
      onMouseLeave={cancel}
      onFocus={() => {
        if (mode !== "disabled") preload();
      }}
      onBlur={cancel}
      to={to}
      end={to === "/"}
      title={label}
      className={({ isActive }) =>
        [
          "nova-nav-link group relative grid size-9 place-items-center rounded-field transition-colors",
          isActive
            ? "text-primary"
            : "text-base-content/45 hover:bg-base-200 hover:text-base-content",
        ].join(" ")
      }
    >
      {({ isActive }) => (
        <>
          {/* Active marker sits in the rule, like a tab in a card index. */}
          <span
            aria-hidden
            className={[
              "absolute -left-[9px] h-5 w-[2px] rounded-full bg-primary transition-opacity",
              isActive ? "opacity-100" : "opacity-0",
            ].join(" ")}
          />
          <Icon className="size-[18px]" strokeWidth={1.75} />

          {/* Label on hover — the width saved by the rail, borrowed back. */}
          <span className="nova-nav-label pointer-events-none absolute left-full z-20 ml-2 whitespace-nowrap rounded-field border rule bg-base-200 px-2 py-1 text-xs opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
            {label}
          </span>
        </>
      )}
    </NavLink>
  );
}
