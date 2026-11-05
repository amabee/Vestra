import { X } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bridge } from "@/lib/bridge";
import {
  hiddenFromContinue,
  type ContinueTarget,
} from "../../../shared/continue-shelf";
const key = ["continue-shelf"] as const;
export function useContinueShelf() {
  const cache = useQueryClient();
  const [undo, setUndo] = useState<ContinueTarget | null>(null);
  const query = useQuery({
    queryKey: key,
    queryFn: () => bridge.continueShelf.list(),
    staleTime: 0,
  });
  const remove = useMutation({
    mutationFn: bridge.continueShelf.dismiss,
    onSuccess: (rows, target) => {
      cache.setQueryData(key, rows);
      setUndo(target);
    },
  });
  const restore = useMutation({
    mutationFn: bridge.continueShelf.restore,
    onSuccess: (rows) => {
      cache.setQueryData(key, rows);
      setUndo(null);
    },
  });
  return {
    isPending: query.isPending,
    hidden: (target: ContinueTarget, activity: number) =>
      hiddenFromContinue(target, activity, query.data ?? {}),
    remove,
    restore,
    undo,
    error: remove.error ?? restore.error ?? query.error,
  };
}
export function ContinueShelfNotice({
  shelf,
}: {
  shelf: ReturnType<typeof useContinueShelf>;
}) {
  return (
    <>
      {shelf.error && (
        <p role="alert" className="my-3 text-sm text-error">
          Could not update Continue: {shelf.error.message}
        </p>
      )}
      {shelf.undo && (
        <p role="status" className="my-3 text-sm">
          Removed from Continue.{" "}
          <button
            className="btn btn-ghost btn-xs"
            disabled={shelf.restore.isPending}
            onClick={() => shelf.restore.mutate(shelf.undo!)}
          >
            Undo
          </button>
        </p>
      )}
    </>
  );
}

export function RemoveFromContinueButton({
  title,
  onClick,
  disabled,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-xs mt-2 w-full"
      aria-label={`Remove ${title} from Continue`}
      title="Remove from Continue"
      disabled={disabled}
      onClick={onClick}
    >
      <X className="size-3.5" />
      Remove
    </button>
  );
}
