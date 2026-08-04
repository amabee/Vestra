import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isSameMedia, type MediaItem } from "@vestra/types";
import { Bookmark, BookmarkCheck, Ellipsis, Loader2, Play } from "lucide-react";
import { useNavigate } from "react-router";

import { bridge } from "@/lib/bridge";
import { usePlayer } from "@/lib/player-store";
import { useWatchlist } from "@/lib/queries";

/**
 * Row actions.
 *
 * Hidden until the row is hovered or focused, which keeps a long list quiet —
 * a catalogue page with three buttons on every line reads as a control panel.
 * They stay visible once an item is on the watchlist, because that is state
 * rather than an affordance.
 */
export function EntryActions({ item }: { item: MediaItem }) {
  const queryClient = useQueryClient();
  const { data: watchlist = [] } = useWatchlist();
  const openPlayer = usePlayer((state) => state.open);
  const navigate = useNavigate();

  const saved = watchlist.some((entry) => isSameMedia(entry.ref, item));

  const toggleSaved = useMutation({
    mutationFn: () =>
      saved ? bridge.watchlist.remove(item) : bridge.watchlist.add(item, "planned"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  const play = useMutation({
    mutationFn: async () => {
      const sources = await bridge.media.resolvePlayback(item);
      const best = sources[0];
      if (!best) throw new Error("No playable source found.");

      // More than one source means episodes. Picking the first for someone is
      // a guess, and usually the wrong one — send them to the list instead.
      if (sources.length > 1) {
        void navigate(
          `/media/${item.source}/${item.kind}/${encodeURIComponent(item.sourceId)}`,
        );
        return;
      }

      // Web destinations open where they can actually play; anything Vestra
      // serves itself goes to the in-app player.
      if (best.locator.startsWith("http")) {
        await bridge.shell.openExternal(best.locator);
        return;
      }

      openPlayer(item, [best]);
    },
  });

  return (
    <div className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 data-[pinned=true]:opacity-100">
      <ActionButton
        label="Play"
        busy={play.isPending}
        onClick={() => play.mutate()}
        primary
      >
        <Play className="size-3.5 fill-current" />
      </ActionButton>

      <ActionButton
        label={saved ? "Remove from library" : "Add to library"}
        busy={toggleSaved.isPending}
        onClick={() => toggleSaved.mutate()}
        pinned={saved}
      >
        {saved ? (
          <BookmarkCheck className="size-4 text-accent" />
        ) : (
          <Bookmark className="size-4" />
        )}
      </ActionButton>

      <MoreMenu item={item} />
    </div>
  );
}

function ActionButton({
  label,
  busy,
  primary,
  pinned,
  onClick,
  children,
}: {
  label: string;
  busy?: boolean;
  primary?: boolean;
  pinned?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-pinned={pinned}
      disabled={busy}
      onClick={(event) => {
        // The whole row is a button; these must not trigger it.
        event.stopPropagation();
        onClick();
      }}
      className={[
        "grid size-8 place-items-center rounded-field border transition-colors",
        primary
          ? "border-primary/40 text-primary hover:bg-primary hover:text-primary-content"
          : "rule text-base-content/60 hover:bg-base-300 hover:text-base-content",
        pinned ? "opacity-100" : "",
      ].join(" ")}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : children}
    </button>
  );
}

function MoreMenu({ item }: { item: MediaItem }) {
  return (
    <div className="dropdown dropdown-end" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        tabIndex={0}
        title="More"
        aria-label="More"
        className="grid size-8 place-items-center rounded-field border rule text-base-content/60 transition-colors hover:bg-base-300 hover:text-base-content"
      >
        <Ellipsis className="size-4" />
      </button>

      <ul
        tabIndex={0}
        className="dropdown-content menu z-30 w-52 rounded-box border rule bg-base-200 p-1 text-[13px] shadow-xl"
      >
        <li>
          <button type="button" onClick={() => void navigator.clipboard.writeText(item.title)}>
            Copy title
          </button>
        </li>
        {item.sourceUrl ? (
          <li>
            <button
              type="button"
              onClick={() => void bridge.shell.openExternal(item.sourceUrl ?? "")}
            >
              Open on {item.source}
            </button>
          </li>
        ) : null}
        <li>
          <button type="button" onClick={() => void bridge.progress.clear(item)}>
            Clear watch progress
          </button>
        </li>
      </ul>
    </div>
  );
}
