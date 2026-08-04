import { createRoot } from "react-dom/client";

import { PlayerChrome } from "@/components/player/player-chrome";

import "./styles/theme.css";

/**
 * The controls window.
 *
 * A second, much smaller React root. It runs in a transparent window stacked
 * over mpv's video surface, which is the only way to draw on top of a native
 * video window — so this is what makes the controls float over the picture
 * instead of pushing it around.
 *
 * It has no router, no query client and no catalogue data. Playback state
 * arrives from mpv, and the little it needs beyond that comes from the
 * catalogue window over the bridge.
 */

const container = document.getElementById("overlay-root");
if (!container) throw new Error("overlay-root is missing from overlay.html");

createRoot(container).render(<PlayerChrome />);
