/**
 * Player icons.
 *
 * Drawn here rather than pulled from an icon library so the control bar reads
 * as part of Vestra. The set is deliberately consistent: 24×24 box, 1.5 stroke
 * on outlines, square caps and joins, and solid shapes only where a control is
 * a state rather than an action — play, pause and the skip triangles.
 *
 * The angular corners echo the interface's 0.25rem radius; rounded caps would
 * read as a different product.
 */

type IconProps = { className?: string };

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "square" as const,
  strokeLinejoin: "miter" as const,
};

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export function PlayIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M7 4.5 20 12 7 19.5Z" fill="currentColor" />
    </Svg>
  );
}

export function PauseIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" fill="currentColor" />
    </Svg>
  );
}

/** Step back: a triangle pointing at a bar. */
export function PreviousIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M19 5 8 12l11 7Z" fill="currentColor" />
      <path d="M5.5 5v14" {...stroke} />
    </Svg>
  );
}

export function NextIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5 5l11 7-11 7Z" fill="currentColor" />
      <path d="M18.5 5v14" {...stroke} />
    </Svg>
  );
}

/** Seek back — an arc with the step written inside it. */
export function RewindIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 10.5V5m0 5.5h5.5" {...stroke} />
      <path d="M4.6 10.4A8 8 0 1 1 4 14.2" {...stroke} />
      <text
        x="12"
        y="15.5"
        textAnchor="middle"
        fontSize="7.5"
        fill="currentColor"
        stroke="none"
        fontFamily="inherit"
      >
        10
      </text>
    </Svg>
  );
}

export function ForwardIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M20 10.5V5m0 5.5h-5.5" {...stroke} />
      <path d="M19.4 10.4A8 8 0 1 0 20 14.2" {...stroke} />
      <text
        x="12"
        y="15.5"
        textAnchor="middle"
        fontSize="7.5"
        fill="currentColor"
        stroke="none"
        fontFamily="inherit"
      >
        10
      </text>
    </Svg>
  );
}

export function VolumeHighIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 9h3.5L12 5v14L7.5 15H4Z" fill="currentColor" />
      <path d="M15.5 9.5a4 4 0 0 1 0 5M18 7a7.5 7.5 0 0 1 0 10" {...stroke} />
    </Svg>
  );
}

export function VolumeLowIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 9h3.5L12 5v14L7.5 15H4Z" fill="currentColor" />
      <path d="M15.5 9.5a4 4 0 0 1 0 5" {...stroke} />
    </Svg>
  );
}

export function VolumeMutedIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 9h3.5L12 5v14L7.5 15H4Z" fill="currentColor" />
      <path d="M16 9.5l5 5m0-5-5 5" {...stroke} />
    </Svg>
  );
}

/** Subtitles: a frame with two lines of text in it. */
export function SubtitlesIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="2.75" y="5.75" width="18.5" height="12.5" {...stroke} />
      <path d="M6 11.5h5M13 11.5h5M6 14.75h3M11 14.75h7" {...stroke} />
    </Svg>
  );
}

export function SubtitlesOffIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="2.75" y="5.75" width="18.5" height="12.5" {...stroke} opacity={0.5} />
      <path d="M6 11.5h5M13 11.5h5" {...stroke} opacity={0.5} />
      <path d="M3.5 19.5 20.5 4.5" {...stroke} />
    </Svg>
  );
}

/** Audio tracks: overlapping waveform bars. */
export function AudioTrackIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 10v4M8 7v10M12 4.5v15M16 7v10M20 10v4" {...stroke} />
    </Svg>
  );
}

/** Speed: a dial with its needle off-centre. */
export function SpeedIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3.5 18a9 9 0 1 1 17 0" {...stroke} />
      <path d="M12 18 17 9.5" {...stroke} />
    </Svg>
  );
}

export function FullscreenIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3.5 9V3.5H9M15 3.5h5.5V9M20.5 15v5.5H15M9 20.5H3.5V15" {...stroke} />
    </Svg>
  );
}

export function ExitFullscreenIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9 3.5V9H3.5M20.5 9H15V3.5M15 20.5V15h5.5M3.5 15H9v5.5" {...stroke} />
    </Svg>
  );
}

export function BackIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M20 12H4.5m0 0L11 5.5M4.5 12 11 18.5" {...stroke} />
    </Svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5.5 5.5l13 13m0-13-13 13" {...stroke} />
    </Svg>
  );
}

/** Skip marker: a double chevron against a stop bar. */
export function SkipSegmentIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 5.5 11 12l-7 6.5ZM11.5 5.5 18.5 12l-7 6.5Z" fill="currentColor" />
      <path d="M21 5.5v13" {...stroke} />
    </Svg>
  );
}

export function SpinnerIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="8.5" {...stroke} opacity={0.2} />
      <path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" {...stroke} />
    </Svg>
  );
}
