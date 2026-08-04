import { Minus, Square, X } from "lucide-react";

import { bridge } from "@/lib/bridge";

/**
 * Window chrome.
 *
 * The window is frameless, so this replaces the OS title bar entirely. It is
 * kept deliberately thin and quiet: it is the one element on screen that is
 * never what the user came for, so it should not compete with the catalogue.
 *
 * The whole strip drags except the controls, which is what `.drag-region` and
 * `.no-drag` are for.
 */
export function TitleBar({ children }: { children?: React.ReactNode }) {
  const isMac = bridge.platform() === "darwin";

  return (
    <header
      className="drag-region flex h-11 shrink-0 items-center gap-3 border-b rule px-3"
      // macOS draws its own traffic lights via titleBarStyle; leave room.
      style={isMac ? { paddingLeft: "5rem" } : undefined}
    >
      <span className="font-serif text-[15px] leading-none tracking-tight">
        Vestra
      </span>

      <div className="no-drag min-w-0 flex-1">{children}</div>

      {!isMac ? (
        <div className="no-drag flex items-center">
          <WindowButton label="Minimise" onClick={() => void bridge.window.minimize()}>
            <Minus className="size-3.5" />
          </WindowButton>
          <WindowButton
            label="Maximise"
            onClick={() => void bridge.window.toggleMaximize()}
          >
            <Square className="size-3" />
          </WindowButton>
          <WindowButton label="Close" danger onClick={() => void bridge.window.close()}>
            <X className="size-3.5" />
          </WindowButton>
        </div>
      ) : null}
    </header>
  );
}

function WindowButton({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={[
        "grid h-11 w-11 place-items-center text-base-content/50 transition-colors",
        danger ? "hover:bg-error hover:text-error-content" : "hover:bg-base-200 hover:text-base-content",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
