import { AppearanceController } from "./appearance";
import { useSettings, keys } from "@/lib/queries";
import { bridge } from "@/lib/bridge";
import { UpdatePrompt } from "@/components/updates/update-prompt";
import { UpdateIndicator } from "@/components/updates/app-updates";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import {
  Outlet,
  useNavigate,
  useLocation,
  useSearchParams,
} from "react-router";

import { NavRail } from "@/components/chrome/nav-rail";
import { TitleBar } from "@/components/chrome/title-bar";
import { PlayerOverlay } from "@/components/player/player-overlay";

/**
 * Application shell.
 *
 * Title bar across the top, rail down the left, everything else is catalogue.
 * The search field lives in the title bar rather than in a page, because in a
 * desktop app search is chrome — always reachable, never a destination.
 */
export function AppShell() {
  const { data: settings } = useSettings();
  const cache = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const firstPath = useRef(location.pathname);
  const started = useRef(false);
  useEffect(
    () =>
      bridge.anilistAccount.onChanged((value) => {
        cache.setQueryData(["anilist-account"], value);
        void cache.invalidateQueries({ queryKey: ["watchlist"] });
        void cache.invalidateQueries({ queryKey: ["manga-bookmarks"] });
        void cache.invalidateQueries({ queryKey: ["anilist-lists"] });
      }),
    [cache],
  );
  useEffect(
    () =>
      bridge.settings.onChanged?.((value) =>
        cache.setQueryData(keys.settings, value),
      ),
    [cache],
  );
  useEffect(() => {
    if (!settings || started.current) return;
    started.current = true;
    if (
      firstPath.current === "/" &&
      location.pathname === "/" &&
      settings.app.startupPage !== "/"
    )
      void navigate(settings.app.startupPage, { replace: true });
  }, [settings, location.pathname, navigate]);
  return (
    <div className="nova-shell relative isolate flex h-full flex-col overflow-hidden">
      {settings?.appearance.backgroundImage && (
        <img
          className="workspace-background"
          src={`vestra-media://appearance/backgroundImage?v=${encodeURIComponent(settings.appearance.backgroundImage)}`}
          alt=""
        />
      )}
      <AppearanceController />
      <TitleBar>
        {settings?.appearance.hideTopNavbar !== true && <CommandField />}
      </TitleBar>

      <div className="flex min-h-0 flex-1">
        <NavRail />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      {settings?.app.showStatusBar !== false && <StatusBar />}
      <PlayerOverlay />
      <UpdatePrompt />
    </div>
  );
}

function CommandField() {
  const [value, setValue] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const animeContext =
    ["/", "/anime", "/discover", "/schedule"].includes(location.pathname) ||
    /\/media\/[^/]+\/anime\//.test(location.pathname);

  if (location.pathname === "/anime") return null;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const query = value.trim();
        if (query.length > 0)
          void navigate(
            animeContext
              ? `/anime?${new URLSearchParams({ q: query, ...(params.get("source") ? { source: params.get("source")! } : {}) })}`
              : `/search?q=${encodeURIComponent(query)}`,
          );
      }}
      className="mx-auto flex h-7 w-full max-w-md items-center gap-2 rounded-field border rule bg-base-200/60 px-2.5 transition-colors focus-within:border-primary/50"
    >
      <Search className="size-3.5 shrink-0 text-base-content/40" />
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label={
          animeContext ? "Search anime from anywhere" : "Search your catalogue"
        }
        placeholder={animeContext ? "Search anime" : "Search your catalogue"}
        spellCheck={false}
        maxLength={200}
        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-base-content/35"
      />
    </form>
  );
}

/**
 * Status bar.
 *
 * Borrowed from editors rather than media apps. It keeps provider health and
 * library size permanently visible instead of hiding them in a settings page,
 * which suits a user who actually cares whether TMDb is reachable.
 */
function StatusBar() {
  const { data } = useQuery({
    queryKey: ["diagnostics"],
    queryFn: async () => {
      const { bridge } = await import("@/lib/bridge");
      return bridge.app.diagnostics();
    },
    staleTime: 60_000,
  });

  const ready =
    data?.providers.filter((provider) => provider.available).length ?? 0;
  const total = data?.providers.length ?? 0;

  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t rule px-3">
      <span className="meta">
        {total > 0 ? `${ready}/${total} sources` : "connecting"}
      </span>
      <span className="meta">{data?.counts.localFiles ?? 0} files indexed</span>
      <span className="meta">{data?.counts.watchlist ?? 0} on watchlist</span>
      <div className="flex-1" />
      <UpdateIndicator />
      {data?.extensions.length ? (
        <span className="meta">{data.extensions.length} extensions</span>
      ) : null}
    </footer>
  );
}
