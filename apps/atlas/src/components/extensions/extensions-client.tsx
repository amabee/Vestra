"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  analyzeTrust,
  EXTENSION_TYPE_LABEL,
  EXTENSION_TYPES,
  type ExtensionType,
  languagesOf,
  type MarketplaceEntry,
  type MarketplaceSort,
  sortEntries,
  SUPPORTED_EXTENSION_TYPES,
} from "@vestra/provider-sdk";
import { Badge, Button, cn, EmptyState, GlassCard } from "@vestra/ui";
import {
  Blocks,
  Globe,
  Info,
  Link2,
  LoaderCircle,
  Package,
  RefreshCw,
  Search,
  ShieldAlert,
  TriangleAlert,
  X,
} from "lucide-react";
import type * as React from "react";
import { useMemo, useState } from "react";

import { toast } from "@/components/ui/toaster";

import { ExtensionCard } from "./extension-card";
import { ExtensionDetails } from "./extension-details";
import { PermissionDialog, type InstallPlanView } from "./permission-dialog";

/** Mirrors the install record, kept local so the client never imports the installer. */
export interface InstalledRecord {
  id: string;
  name: string;
  version: string;
  integrity: string;
  pinned: boolean;
  driftDetectedAt: string | null;
}

interface RegistryResponse {
  url: string;
  entries: MarketplaceEntry[];
  rejected: number;
}

interface ExtensionsClientProps {
  initialRegistries: string[];
  initialInstalled: InstalledRecord[];
}

type Tab = "installed" | "marketplace";

const SORT_LABEL: Record<MarketplaceSort, string> = {
  stars: "Most starred",
  updated: "Recently updated",
  name: "Name",
};

/**
 * Extension browser.
 *
 * Vestra ships no registry of its own: the user supplies the index, and the
 * index is treated as hostile throughout — fetched server-side, schema-checked,
 * and rendered with its own health and scan data on show rather than hidden
 * behind a single install button.
 */
export function ExtensionsClient({
  initialRegistries,
  initialInstalled,
}: ExtensionsClientProps) {
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>("marketplace");
  const [repoDraft, setRepoDraft] = useState("");
  const [editingRepo, setEditingRepo] = useState(false);
  const [inspecting, setInspecting] = useState<MarketplaceEntry | null>(null);
  const [pendingEntry, setPendingEntry] = useState<MarketplaceEntry | null>(null);
  const [pendingPlan, setPendingPlan] = useState<InstallPlanView | null>(null);

  const [query, setQuery] = useState("");
  const [type, setType] = useState<ExtensionType | "all">("all");
  const [lang, setLang] = useState("all");
  const [sort, setSort] = useState<MarketplaceSort>("stars");
  const [hideUnsupported, setHideUnsupported] = useState(true);

  const [registries, setRegistries] = useState(initialRegistries);
  const activeRegistry = registries[0] ?? null;

  const installedQuery = useQuery({
    queryKey: ["extensions-installed"],
    queryFn: async () => {
      const response = await fetch("/api/extensions/installed");
      if (!response.ok) throw new Error("Could not load installed extensions");
      return ((await response.json()) as { installed: InstalledRecord[] }).installed;
    },
    initialData: initialInstalled,
  });

  const marketplace = useQuery({
    queryKey: ["extension-registry", activeRegistry],
    enabled: activeRegistry !== null,
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const response = await fetch(
        `/api/extensions/registry?url=${encodeURIComponent(activeRegistry ?? "")}`,
      );
      const payload = (await response.json()) as RegistryResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not load that registry.");
      return payload;
    },
  });

  const saveRepo = useMutation({
    mutationFn: async (url: string) => {
      const response = await fetch("/api/extensions/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const payload = (await response.json()) as { registries?: string[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not save that URL.");
      return payload.registries ?? [];
    },
    onSuccess: (next) => {
      setRegistries(next);
      setEditingRepo(false);
      setRepoDraft("");
      toast("Repository saved");
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  /** Phase one: read the manifest so the user can see what is being asked for. */
  const prepare = useMutation({
    mutationFn: async (entry: MarketplaceEntry) => {
      const response = await fetch("/api/extensions/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phase: "prepare",
          candidate: candidateOf(entry, activeRegistry ?? ""),
        }),
      });
      const payload = (await response.json()) as { plan?: InstallPlanView; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not read that extension.");
      return payload.plan ?? null;
    },
    onSuccess: (plan) => setPendingPlan(plan),
    onError: (error: Error) => {
      setPendingEntry(null);
      toast(error.message, "error");
    },
  });

  /** Phase two: fetch and store the code under the permissions actually granted. */
  const install = useMutation({
    mutationFn: async (input: { entry: MarketplaceEntry; granted: string[] }) => {
      const response = await fetch("/api/extensions/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phase: "commit",
          candidate: candidateOf(input.entry, activeRegistry ?? ""),
          granted: input.granted,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not install that extension.");
    },
    onSuccess: () => {
      setPendingEntry(null);
      setPendingPlan(null);
      toast("Installed — it will activate once the extension runtime ships");
      void queryClient.invalidateQueries({ queryKey: ["extensions-installed"] });
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  const uninstall = useMutation({
    mutationFn: async (entry: MarketplaceEntry) => {
      const response = await fetch(
        `/api/extensions/installed?id=${encodeURIComponent(entry.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("Could not remove that extension.");
    },
    onSuccess: () => {
      toast("Removed");
      void queryClient.invalidateQueries({ queryKey: ["extensions-installed"] });
    },
    onError: (error: Error) => toast(error.message, "error"),
  });

  const beginInstall = (entry: MarketplaceEntry) => {
    setPendingEntry(entry);
    prepare.mutate(entry);
  };

  const allEntries = useMemo(() => marketplace.data?.entries ?? [], [marketplace.data]);
  const records = useMemo(() => installedQuery.data ?? [], [installedQuery.data]);
  const installed = useMemo(() => records.map((record) => record.id), [records]);

  const scope = useMemo(
    () =>
      tab === "installed"
        ? allEntries.filter((entry) => installed.includes(entry.id))
        : allEntries,
    [tab, allEntries, installed],
  );

  const languages = useMemo(() => languagesOf(scope), [scope]);

  const typeCounts = useMemo(() => {
    const counts = new Map<ExtensionType, number>();
    for (const entry of scope) counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
    return counts;
  }, [scope]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const matches = scope.filter((entry) => {
      if (hideUnsupported && !SUPPORTED_EXTENSION_TYPES.includes(entry.type)) return false;
      if (type !== "all" && entry.type !== type) return false;
      if (lang !== "all" && entry.lang.toLowerCase() !== lang) return false;
      if (needle.length === 0) return true;

      return (
        entry.name.toLowerCase().includes(needle) ||
        entry.id.toLowerCase().includes(needle) ||
        entry.author.toLowerCase().includes(needle) ||
        entry.description.toLowerCase().includes(needle)
      );
    });

    return sortEntries(matches, sort);
  }, [scope, query, type, lang, sort, hideUnsupported]);

  const grouped = useMemo(() => {
    const groups = new Map<ExtensionType, MarketplaceEntry[]>();
    for (const entry of filtered) {
      const bucket = groups.get(entry.type);
      if (bucket) bucket.push(entry);
      else groups.set(entry.type, [entry]);
    }
    return [...groups.entries()].sort(
      (a, b) =>
        EXTENSION_TYPES.indexOf(a[0]) - EXTENSION_TYPES.indexOf(b[0]),
    );
  }, [filtered]);

  const risk = useMemo(() => {
    let unscanned = 0;
    let mutable = 0;
    for (const entry of filtered) {
      const trust = analyzeTrust(entry);
      if (!trust.scan.scanned) unscanned += 1;
      if (trust.hasPayload && !trust.pinned) mutable += 1;
    }
    return { unscanned, mutable };
  }, [filtered]);

  const busy = prepare.isPending || install.isPending || uninstall.isPending;

  return (
    <div className="space-y-6 pb-10">
      <Header
        tab={tab}
        onTab={setTab}
        installedCount={installed.length}
        registry={activeRegistry}
        refreshing={marketplace.isFetching}
        onRefresh={() => void marketplace.refetch()}
        onEditRepo={() => {
          setRepoDraft(activeRegistry ?? "");
          setEditingRepo((open) => !open);
        }}
        editing={editingRepo}
      />

      {editingRepo || activeRegistry === null ? (
        <RepositoryEditor
          value={repoDraft}
          onChange={setRepoDraft}
          onSubmit={() => saveRepo.mutate(repoDraft.trim())}
          pending={saveRepo.isPending}
          firstRun={activeRegistry === null}
        />
      ) : null}

      {activeRegistry === null ? null : marketplace.isPending ? (
        <LoadingState />
      ) : marketplace.isError ? (
        <EmptyState
          icon={<TriangleAlert className="size-5" />}
          title="Could not load that repository"
          description={(marketplace.error as Error).message}
          action={
            <Button variant="outline" size="sm" onClick={() => void marketplace.refetch()}>
              <RefreshCw className="size-3.5" />
              Try again
            </Button>
          }
        />
      ) : (
        <>
          <Toolbar
            query={query}
            onQuery={setQuery}
            type={type}
            onType={setType}
            typeCounts={typeCounts}
            total={scope.length}
            lang={lang}
            onLang={setLang}
            languages={languages}
            sort={sort}
            onSort={setSort}
            hideUnsupported={hideUnsupported}
            onHideUnsupported={setHideUnsupported}
          />

          {tab === "marketplace" && filtered.length > 0 ? (
            <RiskSummary
              total={filtered.length}
              unscanned={risk.unscanned}
              mutable={risk.mutable}
              rejected={marketplace.data.rejected}
            />
          ) : null}

          <RuntimeNotice />

          {filtered.length === 0 ? (
            <EmptyState
              icon={<Package className="size-5" />}
              title={tab === "installed" ? "Nothing added yet" : "No extensions match"}
              description={
                tab === "installed"
                  ? "Extensions you add from the marketplace appear here."
                  : "Try a different search, type or language."
              }
            />
          ) : (
            <div className="space-y-8">
              {grouped.map(([groupType, entries]) => (
                <section key={groupType} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Blocks className="size-4 text-muted-foreground" />
                    <h2 className="text-sm font-semibold tracking-tight">
                      {EXTENSION_TYPE_LABEL[groupType]}
                    </h2>
                    <Badge variant="secondary">{entries.length}</Badge>
                    {!SUPPORTED_EXTENSION_TYPES.includes(groupType) ? (
                      <Badge variant="outline">Listed, not installable</Badge>
                    ) : null}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {entries.map((entry) => (
                      <ExtensionCard
                        key={entry.id}
                        entry={entry}
                        installed={installed.includes(entry.id)}
                        busy={busy}
                        onInstall={beginInstall}
                        onUninstall={(value) => uninstall.mutate(value)}
                        onInspect={setInspecting}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      <ExtensionDetails
        entry={inspecting}
        installed={inspecting ? installed.includes(inspecting.id) : false}
        onClose={() => setInspecting(null)}
        onInstall={(entry) => {
          setInspecting(null);
          beginInstall(entry);
        }}
        onUninstall={(entry) => uninstall.mutate(entry)}
      />

      <PermissionDialog
        plan={pendingPlan}
        extensionId={pendingEntry?.id ?? ""}
        pending={install.isPending}
        onCancel={() => {
          setPendingPlan(null);
          setPendingEntry(null);
        }}
        onConfirm={(granted) => {
          if (pendingEntry) install.mutate({ entry: pendingEntry, granted });
        }}
      />
    </div>
  );
}

/** Registry entry to install candidate. */
function candidateOf(entry: MarketplaceEntry, registryUrl: string) {
  return {
    id: entry.id,
    name: entry.name,
    version: entry.version,
    type: entry.type,
    manifestURI: entry.manifestURI,
    payloadURI: entry.payloadURI,
    registryUrl,
  };
}

/* =============================================================================
 * Header
 * ========================================================================== */

function Header({
  tab,
  onTab,
  installedCount,
  registry,
  refreshing,
  onRefresh,
  onEditRepo,
  editing,
}: {
  tab: Tab;
  onTab: (value: Tab) => void;
  installedCount: number;
  registry: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  onEditRepo: () => void;
  editing: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-xl bg-secondary/50 p-1">
        {(["installed", "marketplace"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onTab(value)}
            className={cn(
              "rounded-lg px-4 py-1.5 text-xs font-medium capitalize transition-colors",
              tab === value
                ? "bg-primary text-primary-foreground shadow-soft"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {value}
            {value === "installed" && installedCount > 0 ? ` (${installedCount})` : ""}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {tab === "installed" ? "Installed" : "Marketplace"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {tab === "installed"
              ? "Extensions you have added from a repository."
              : "Third-party extensions. Vestra does not review or endorse them."}
          </p>
          {registry ? (
            <p className="flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground">
              <Link2 className="size-3 shrink-0" />
              {registry}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing || registry === null}
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            Refresh
          </Button>
          <Button variant="secondary" size="sm" onClick={onEditRepo}>
            {editing ? <X className="size-3.5" /> : <Link2 className="size-3.5" />}
            {editing ? "Cancel" : "Change repository"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* =============================================================================
 * Repository editor
 * ========================================================================== */

function RepositoryEditor({
  value,
  onChange,
  onSubmit,
  pending,
  firstRun,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  pending: boolean;
  firstRun: boolean;
}) {
  return (
    <GlassCard className="space-y-3 p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {firstRun ? "Add an extension repository" : "Change repository"}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Vestra ships no repository of its own. Paste the URL of a JSON index you
          trust — its contents are third-party code that will eventually run with
          access to your library.
        </p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) onSubmit();
        }}
        className="flex gap-2"
      >
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="https://example.com/extensions.json"
          spellCheck={false}
          autoComplete="off"
          className="h-9 flex-1 rounded-lg border border-border bg-secondary/40 px-3 font-mono text-[12px] outline-none transition-colors focus:border-primary/50"
        />
        <Button type="submit" size="sm" disabled={pending || value.trim().length === 0}>
          {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
          Save
        </Button>
      </form>
    </GlassCard>
  );
}

/* =============================================================================
 * Toolbar
 * ========================================================================== */

function Toolbar({
  query,
  onQuery,
  type,
  onType,
  typeCounts,
  total,
  lang,
  onLang,
  languages,
  sort,
  onSort,
  hideUnsupported,
  onHideUnsupported,
}: {
  query: string;
  onQuery: (value: string) => void;
  type: ExtensionType | "all";
  onType: (value: ExtensionType | "all") => void;
  typeCounts: Map<ExtensionType, number>;
  total: number;
  lang: string;
  onLang: (value: string) => void;
  languages: string[];
  sort: MarketplaceSort;
  onSort: (value: MarketplaceSort) => void;
  hideUnsupported: boolean;
  onHideUnsupported: (value: boolean) => void;
}) {
  const selectClass =
    "h-9 rounded-lg border border-border bg-secondary/40 px-2.5 text-xs outline-none transition-colors focus:border-primary/50";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterPill active={type === "all"} onClick={() => onType("all")} count={total}>
          All types
        </FilterPill>

        {EXTENSION_TYPES.filter((value) => (typeCounts.get(value) ?? 0) > 0).map((value) => (
          <FilterPill
            key={value}
            active={type === value}
            onClick={() => {
              onType(value);
              // Selecting a type Vestra cannot run would otherwise filter itself
              // down to nothing; asking for it is consent enough to reveal it.
              if (!SUPPORTED_EXTENSION_TYPES.includes(value)) onHideUnsupported(false);
            }}
            count={typeCounts.get(value) ?? 0}
            muted={!SUPPORTED_EXTENSION_TYPES.includes(value)}
          >
            {EXTENSION_TYPE_LABEL[value]}
          </FilterPill>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search extensions"
            className="h-9 w-full rounded-lg border border-border bg-secondary/40 pl-9 pr-3 text-xs outline-none transition-colors focus:border-primary/50"
          />
        </div>

        <div className="relative">
          <Globe className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <select
            value={lang}
            onChange={(event) => onLang(event.target.value)}
            className={cn(selectClass, "pl-8")}
          >
            <option value="all">All languages</option>
            {languages.map((value) => (
              <option key={value} value={value}>
                {value.toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        <select
          value={sort}
          onChange={(event) => onSort(event.target.value as MarketplaceSort)}
          className={selectClass}
        >
          {(Object.keys(SORT_LABEL) as MarketplaceSort[]).map((value) => (
            <option key={value} value={value}>
              {SORT_LABEL[value]}
            </option>
          ))}
        </select>

        <label className="flex h-9 cursor-pointer select-none items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={hideUnsupported}
            onChange={(event) => onHideUnsupported(event.target.checked)}
            className="size-3.5 accent-violet-500"
          />
          Hide excluded types
        </label>
      </div>
    </div>
  );
}

function FilterPill({
  active,
  muted,
  count,
  onClick,
  children,
}: {
  active: boolean;
  muted?: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
        active
          ? "border-primary/50 bg-primary/15 text-violet-soft"
          : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground",
        muted && !active && "opacity-60",
      )}
    >
      {children}
      <span className="tabular-nums opacity-60">{count}</span>
    </button>
  );
}

/* =============================================================================
 * Risk summary
 * ========================================================================== */

function RiskSummary({
  total,
  unscanned,
  mutable,
  rejected,
}: {
  total: number;
  unscanned: number;
  mutable: number;
  rejected: number;
}) {
  if (unscanned === 0 && mutable === 0 && rejected === 0) return null;

  return (
    <GlassCard className="flex flex-wrap items-center gap-x-5 gap-y-2 p-3 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5 font-medium text-foreground">
        <ShieldAlert className="size-3.5 text-amber-400" />
        {total} shown
      </span>

      {unscanned > 0 ? <span>{unscanned} never scanned for malware</span> : null}

      {mutable > 0 ? (
        <span>
          {mutable} served from a branch — the code can change after it was scanned
        </span>
      ) : null}

      {rejected > 0 ? <span>{rejected} entries skipped as malformed</span> : null}
    </GlassCard>
  );
}

/**
 * The sandbox does not exist yet, so "Add" records a choice and nothing more.
 * Saying so here is cheaper than letting someone install four extensions and
 * work out on their own that none of them did anything.
 */
function RuntimeNotice() {
  return (
    <GlassCard className="flex items-start gap-2 p-3 text-[11px] leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <span>
        Vestra has no extension runtime yet. Adding an extension records it here; no
        third-party code is downloaded or executed until the sandbox ships.
      </span>
    </GlassCard>
  );
}

function LoadingState() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <GlassCard key={index} className="h-44 animate-pulse p-4" />
      ))}
    </div>
  );
}
