import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleUserRound } from "lucide-react";
import { Link } from "react-router";
import { bridge } from "@/lib/bridge";

const accountKey = ["anilist-account"];

export function SidebarAniListAccount() {
  const cache = useQueryClient();
  const panel = useRef<HTMLDetailsElement>(null);
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  useEffect(
    () =>
      bridge.anilistAccount.onChanged((value) => {
        cache.setQueryData(accountKey, value);
      }),
    [cache],
  );
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node))
        panel.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const status = useQuery({
    queryKey: accountKey,
    queryFn: bridge.anilistAccount.status,
    retry: false,
    refetchInterval: (query) =>
      ["waiting", "connecting"].includes(query.state.data?.login?.phase ?? "")
        ? 2000
        : 30000,
  });
  const action = useMutation({
    mutationFn: (kind: "sign-in" | "cancel" | "disconnect") => {
      if (kind === "sign-in") return bridge.anilistAccount.signIn();
      if (kind === "cancel") return bridge.anilistAccount.cancelSignIn();
      return bridge.anilistAccount.disconnect();
    },
    onSuccess: (value) => cache.setQueryData(accountKey, value),
    onSettled: () => cache.invalidateQueries({ queryKey: accountKey }),
  });
  const value = status.data;
  const pending = ["waiting", "connecting"].includes(value?.login?.phase ?? "");
  const avatar = value?.user?.avatar;
  const label = value?.connected
    ? (value.user?.name ?? "AniList account")
    : "Sign in with AniList";
  return (
    <details
      ref={panel}
      className="nova-sidebar-account relative mt-auto shrink-0"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          panel.current?.removeAttribute("open");
          panel.current?.querySelector("summary")?.focus();
        }
      }}
    >
      <summary
        aria-label={label}
        title={label}
        className="nova-nav-link group relative grid size-9 cursor-pointer list-none place-items-center rounded-field text-base-content/60 hover:bg-base-200 hover:text-base-content [&::-webkit-details-marker]:hidden"
      >
        {avatar && avatar !== failedAvatar ? (
          <img
            className="size-7 shrink-0 rounded-full object-cover"
            src={avatar}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setFailedAvatar(avatar)}
          />
        ) : (
          <CircleUserRound className="size-6 shrink-0" aria-hidden />
        )}
        <span className="nova-nav-label pointer-events-none absolute left-full z-20 ml-2 whitespace-nowrap rounded-field border rule bg-base-200 px-2 py-1 text-xs opacity-0 shadow-lg group-hover:opacity-100">
          {value?.connected ? "AniList" : "Sign in"}
        </span>
      </summary>
      <div className="absolute bottom-0 left-full z-40 ml-3 rounded-box border rule bg-base-200 p-4 shadow-xl">
        <p className="break-words font-medium">
          {value?.connected ? value.user?.name : "AniList"}
        </p>
        <p role="status" className="my-2 text-xs text-base-content/60">
          {status.isPending
            ? "Checking account…"
            : value?.connected
              ? "Connected to AniList"
              : pending
                ? "Approve access in your browser. Vestra will connect automatically."
                : value?.needsReconnect
                  ? "Your session expired. Sign in again to reconnect."
                  : "Sign in to back up your anime and manga lists."}
        </p>
        {(status.isError ||
          action.isError ||
          value?.login?.message ||
          (value && !value.encryptionAvailable) ||
          value?.login?.configured === false) && (
          <p role="alert" className="my-2 text-xs text-warning">
            {value?.login?.message ||
              (value && !value.encryptionAvailable
                ? "Secure account storage is unavailable."
                : value?.login?.configured === false
                  ? "Update Vestra to enable AniList sign-in."
                  : "Could not complete the account request. Please try again.")}
          </p>
        )}
        <div className="grid gap-2">
          {!value?.connected && (
            <button
              className="btn btn-primary btn-sm"
              disabled={
                status.isPending ||
                action.isPending ||
                pending ||
                !value?.encryptionAvailable ||
                value?.login?.configured === false
              }
              onClick={() => action.mutate("sign-in")}
            >
              {value?.login?.phase === "connecting"
                ? "Finishing sign-in…"
                : pending
                  ? "Waiting for AniList…"
                  : value?.needsReconnect
                    ? "Reconnect with AniList"
                    : "Sign in with AniList"}
            </button>
          )}
          {pending && (
            <button
              className="btn btn-ghost btn-sm"
              disabled={action.isPending}
              onClick={() => action.mutate("cancel")}
            >
              Cancel sign-in
            </button>
          )}
          <Link
            className="btn btn-ghost btn-sm"
            to="/settings?section=app"
            onClick={() => panel.current?.removeAttribute("open")}
          >
            Account & backup settings
          </Link>
          {(value?.connected || value?.needsReconnect || value?.loadError) && (
            <button
              className="btn btn-ghost btn-sm"
              disabled={action.isPending}
              onClick={() => action.mutate("disconnect")}
            >
              Disconnect AniList
            </button>
          )}
        </div>
      </div>
    </details>
  );
}
