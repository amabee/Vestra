import ending from "@/resources/icon/ending.png";
import opening from "@/resources/icon/opening.png";

/**
 * The opening and ending markers.
 *
 * Two files rather than the supplied sheet. That sheet is 24-bit RGB with the
 * pair sitting on solid black — no alpha channel at all — so drawing it here
 * put a black rectangle over the video with a figure lost inside it. Each half
 * is also mostly empty space, which scaled the character down to a smudge at
 * marker size.
 *
 * `.tools/make-song-markers.ps1` lifts the background out and crops each
 * character to what is actually drawn. Re-run it if the artwork changes.
 *
 * Marked `aria-hidden`: the control alongside already reads "Skip opening", and
 * announcing the picture too would only repeat it.
 */
export function SongMarker({
  kind,
  className,
  style,
}: {
  kind: "opening" | "ending";
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <img
      src={kind === "opening" ? opening : ending}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`block shrink-0 object-contain ${className ?? ""}`}
      style={style}
    />
  );
}
