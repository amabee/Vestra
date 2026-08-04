import { NavLink } from "react-router";
import {
  Blocks,
  Clapperboard,
  Compass,
  HardDrive,
  History,
  Bookmark,
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
      { to: "/", label: "Home", icon: Compass },
      { to: "/anime", label: "Anime", icon: Sparkles },
      { to: "/films", label: "Films", icon: Clapperboard },
      { to: "/series", label: "Series", icon: Tv },
    ],
  },
  {
    label: "Yours",
    items: [
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
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-6 border-r rule py-4">
      {SECTIONS.map((section) => (
        <div key={section.label} className="flex flex-col items-center gap-1">
          {section.items.map((item) => (
            <RailLink key={item.to} {...item} />
          ))}
        </div>
      ))}
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
  return (
    <NavLink
      to={to}
      end={to === "/"}
      title={label}
      className={({ isActive }) =>
        [
          "group relative grid size-9 place-items-center rounded-field transition-colors",
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
          <span className="pointer-events-none absolute left-full z-20 ml-2 whitespace-nowrap rounded-field border rule bg-base-200 px-2 py-1 text-xs opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
            {label}
          </span>
        </>
      )}
    </NavLink>
  );
}
