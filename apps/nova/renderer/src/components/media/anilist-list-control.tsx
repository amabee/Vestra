import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bridge } from "@/lib/bridge";
import { aniListStatus } from "../../../../shared/anilist-sync";
import { useEffect } from "react";

export function AniListListControl({
  type,
  source,
  id,
  title,
}: {
  type: "ANIME" | "MANGA";
  source: string;
  id: string;
  title: string;
}) {
  // Other hosts and isolated component fixtures may not supply an account connector.
  if (!bridge.anilistAccount?.lists) return null;
  return <ListControl type={type} source={source} id={id} title={title} />;
}
function ListControl({
  type,
  source,
  id,
  title,
}: {
  type: "ANIME" | "MANGA";
  source: string;
  id: string;
  title: string;
}) {
  const cache = useQueryClient();
  const account = useQuery({
    queryKey: ["anilist-account"],
    queryFn: bridge.anilistAccount.status,
    staleTime: 30000,
  });
  const lists = useQuery({
    queryKey: ["anilist-lists"],
    queryFn: bridge.anilistAccount.lists,
    enabled: !!account.data?.user,
    staleTime: 30000,
  });
  const entry =
    source === "anilist"
      ? lists.data?.find(
          (row) => row.media.type === type && row.mediaId === Number(id),
        )
      : undefined;
  const change = useMutation({
    mutationFn: async (status: string) => {
      const parsed = aniListStatus.parse(status);
      return bridge.anilistAccount.change({
        type,
        source,
        sourceId: id,
        title: title.slice(0, 500),
        ...(source === "anilist" ? { mediaId: Number(id) } : {}),
        action: "status",
        status: parsed,
      });
    },
    onSuccess: (value) => {
      cache.setQueryData(["anilist-account"], value);
      void cache.invalidateQueries({ queryKey: ["anilist-lists"] });
    },
  });
  useEffect(() => {
    if (!account.data?.sync?.pending) change.reset();
  }, [account.data?.sync?.lastSyncAt, account.data?.sync?.pending]);
  useEffect(() => {
    change.reset();
  }, [source, id]);
  if (!account.data?.user) return null;
  return (
    <div className="my-3 flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2">
        AniList
        <select
          aria-label="AniList list status"
          className="select select-sm"
          value={
            change.isPending || change.isSuccess
              ? (change.variables ?? entry?.status ?? "")
              : (entry?.status ?? "")
          }
          disabled={change.isPending || lists.isPending}
          onChange={(e) => change.mutate(e.target.value)}
        >
          <option value="" disabled>
            {lists.isPending ? "Loading…" : "Add to list"}
          </option>
          <option value="PLANNING">
            {type === "ANIME" ? "Plan to watch" : "Plan to read"}
          </option>
          <option value="CURRENT">
            {type === "ANIME" ? "Watching" : "Reading"}
          </option>
          <option value="COMPLETED">Completed</option>
          <option value="PAUSED">Paused</option>
          <option value="DROPPED">Dropped</option>
          <option value="REPEATING">
            {type === "ANIME" ? "Rewatching" : "Rereading"}
          </option>
        </select>
      </label>
      {entry && (
        <span>
          {entry.progress}{" "}
          {type === "ANIME" ? "episodes watched" : "chapters read"}
        </span>
      )}
      {change.isSuccess && <span role="status">Change queued for sync</span>}
      {(change.error || lists.error) && (
        <span role="alert">{(change.error || lists.error)?.message}</span>
      )}
    </div>
  );
}
