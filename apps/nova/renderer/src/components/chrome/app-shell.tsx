import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { Outlet, useNavigate } from "react-router";

import { NavRail } from "@/components/chrome/nav-rail";
import { TitleBar } from "@/components/chrome/title-bar";

/**
 * Application shell.
 *
 * Title bar across the top, rail down the left, everything else is catalogue.
 * The search field lives in the title bar rather than in a page, because in a
 * desktop app search is chrome — always reachable, never a destination.
 */
export function AppShell() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TitleBar>
        <CommandField />
      </TitleBar>

      <div className="flex min-h-0 flex-1">
        <NavRail />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <StatusBar />
    </div>
  );
}

function CommandField() {
  const [value, setValue] = useState("");
  const navigate = useNavigate();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const query = value.trim();
        if (query.length > 0) void navigate(`/search?q=${encodeURIComponent(query)}`);
      }}
      className="mx-auto flex h-7 w-full max-w-md items-center gap-2 rounded-field border rule bg-base-200/60 px-2.5 transition-colors focus-within:border-primary/50"
    >
      <Search className="size-3.5 shrink-0 text-base-content/40" />
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search your catalogue"
        spellCheck={false}
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

  const ready = data?.providers.filter((provider) => provider.available).length ?? 0;
  const total = data?.providers.length ?? 0;

  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t rule px-3">
      <span className="meta">
        {total > 0 ? `${ready}/${total} sources` : "connecting"}
      </span>
      <span className="meta">{data?.counts.localFiles ?? 0} files indexed</span>
      <span className="meta">{data?.counts.watchlist ?? 0} on watchlist</span>
      <div className="flex-1" />
      {data?.extensions.length ? (
        <span className="meta">{data.extensions.length} extensions</span>
      ) : null}
    </footer>
  );
}
