import { animeMessage } from "./anime-message";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mediaKey, type MediaItem } from "@vestra/types";
import { Check, Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { bridge } from "@/lib/bridge";
import { keys, useWatchlist } from "@/lib/queries";
import type { PlaylistCommand } from "../../../../shared/playlists";
import "./anime-workspace.css";

export const playlistKey = ["anime-playlists"] as const;
export function PlaylistPicker({
  item,
  provider,
  onClose,
}: {
  item: MediaItem;
  provider: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [name, setName] = useState("");
  const cache = useQueryClient();
  const lists = useQuery({
    queryKey: playlistKey,
    queryFn: bridge.playlists.list,
  });
  const watchlist = useWatchlist();
  const saved = watchlist.data?.some(
    (row) => mediaKey(row.ref) === mediaKey(item),
  );
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const change = useMutation({
    mutationFn: async (command: PlaylistCommand | "later") => {
      if (command === "later") {
        if (saved) await bridge.watchlist.remove(item);
        else await bridge.watchlist.add(item, "planned");
        await cache.invalidateQueries({ queryKey: keys.watchlist });
        return;
      }
      const rows = await bridge.playlists.mutate(command);
      cache.setQueryData(playlistKey, rows);
      if (command.action === "create") {
        const created = rows.at(-1)!;
        cache.setQueryData(
          playlistKey,
          await bridge.playlists.mutate({
            action: "add",
            id: created.id,
            entry: { item, provider },
          }),
        );
        setName("");
      }
    },
  });
  return (
    <dialog
      ref={dialog}
      className="anime-save-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="anime-save-body">
        <header>
          <div>
            <h2 id={titleId}>Save to a playlist</h2>
            <p>{item.title}</p>
          </div>
          <button
            type="button"
            aria-label="Close playlist picker"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {(lists.error || watchlist.error || change.error) && (
          <p role="alert">
            {animeMessage(lists.error ?? watchlist.error ?? change.error)}
            <button
              type="button"
              onClick={() => {
                void lists.refetch();
                void watchlist.refetch();
              }}
            >
              Retry loading lists
            </button>
          </p>
        )}
        {lists.isPending || watchlist.isPending ? (
          <p role="status">Loading your lists…</p>
        ) : (
          <div className="anime-save-options">
            <button
              type="button"
              role="checkbox"
              aria-checked={!!saved}
              disabled={change.isPending}
              onClick={() => change.mutate("later")}
            >
              <span>Watch later</span>
              {saved ? <Check size={18} /> : <Plus size={18} />}
            </button>
            {lists.data?.map((list) => {
              const included = list.items.some(
                (row) => mediaKey(row.item) === mediaKey(item),
              );
              return (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={included}
                  disabled={change.isPending}
                  key={list.id}
                  onClick={() =>
                    change.mutate(
                      included
                        ? { action: "remove", id: list.id, key: mediaKey(item) }
                        : {
                            action: "add",
                            id: list.id,
                            entry: { item, provider },
                          },
                    )
                  }
                >
                  <span>
                    {list.name}
                    <small>
                      {list.items.length}{" "}
                      {list.items.length === 1 ? "title" : "titles"}
                    </small>
                  </span>
                  {included ? <Check size={18} /> : <Plus size={18} />}
                </button>
              );
            })}
          </div>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim())
              change.mutate({ action: "create", name: name.trim() });
          }}
        >
          <label htmlFor={`${titleId}-name`}>Create a playlist</label>
          <div>
            <input
              id={`${titleId}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              placeholder="Weekend anime"
            />
            <button type="submit" disabled={!name.trim() || change.isPending}>
              Create & save
            </button>
          </div>
        </form>
        <button type="button" className="anime-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </dialog>
  );
}
