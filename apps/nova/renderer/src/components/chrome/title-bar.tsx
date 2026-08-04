import { bridge } from "@/lib/bridge";

/**
 * Window chrome.
 *
 * The window is frameless, so this replaces the OS title bar entirely. It stays
 * thin and quiet: it is the one element on screen that is never what the user
 * came for.
 *
 * Controls are macOS traffic lights, on the left, on every platform. Styling
 * them as circles but leaving them on the right in Windows order would be a
 * hybrid matching neither convention — if the app borrows the idiom it should
 * borrow the placement too.
 *
 * The whole strip drags except the controls and the search field, which is what
 * `.drag-region` and `.no-drag` mark.
 */
export function TitleBar({ children }: { children?: React.ReactNode }) {
  return (
    <header className="drag-region flex h-11 shrink-0 items-center gap-4 border-b rule px-4">
      <TrafficLights />

      <span className="font-serif text-[15px] leading-none tracking-tight">Vestra</span>

      <div className="no-drag min-w-0 flex-1">{children}</div>

      {/* Balances the lights so the search field sits optically centred. */}
      <div aria-hidden className="w-[4.5rem] shrink-0" />
    </header>
  );
}

function TrafficLights() {
  return (
    // `group` drives the glyphs: at rest these are plain colour, and the
    // symbols appear only when the cluster is hovered, as on macOS.
    <div className="no-drag group flex shrink-0 items-center gap-2">
      <Light
        label="Close"
        color="bg-[#ff5f57]"
        onClick={() => void bridge.window.close()}
      >
        <path
          d="M3.6 3.6l4.8 4.8M8.4 3.6l-4.8 4.8"
          stroke="#4c0002"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </Light>

      <Light
        label="Minimise"
        color="bg-[#febc2e]"
        onClick={() => void bridge.window.minimize()}
      >
        <path d="M3.2 6h5.6" stroke="#5c3c00" strokeWidth="1.5" strokeLinecap="round" />
      </Light>

      <Light
        label="Maximise"
        color="bg-[#28c840]"
        onClick={() => void bridge.window.toggleMaximize()}
      >
        <path
          d="M4.1 4.1h3.4v3.4zM7.9 7.9H4.5V4.5z"
          fill="#003f07"
          stroke="#003f07"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />
      </Light>
    </div>
  );
}

function Light({
  label,
  color,
  onClick,
  children,
}: {
  label: string;
  color: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={[
        "grid size-3 place-items-center rounded-full transition-[filter] hover:brightness-110",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-base-content/40",
        color,
      ].join(" ")}
    >
      <svg
        viewBox="0 0 12 12"
        className="size-3 opacity-0 transition-opacity group-hover:opacity-100"
      >
        {children}
      </svg>
    </button>
  );
}
