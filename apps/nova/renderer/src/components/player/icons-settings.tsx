/**
 * The settings control's icon.
 *
 * Kept apart from the playback icons because it is the one control that opens
 * something rather than doing something — three sliders, matching the square
 * caps and mitre joins the rest of the set uses.
 */
export function PlayerSettingsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="square"
        strokeLinejoin="miter"
      >
        <path d="M3.5 7.5h5M13 7.5h7.5M3.5 16.5h7.5M15.5 16.5h5" />
        <path d="M10.75 5.25v4.5M13.25 14.25v4.5" />
      </g>
    </svg>
  );
}
