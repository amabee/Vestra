import { extensionKinds, matchesExtensionCategory, type CategorizedExtension } from "@/lib/extension-category";
import {
  ExtensionArtwork,
  extensionDescription,
} from "@/components/extensions/extension-artwork";
import { RemoteSourceReview } from "@/components/sources/remote-source";
import type { RemoteSourcePlan } from "../../../shared/sources";
import { ProviderExtensions } from "@/components/extensions/provider-extensions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PERMISSION_DESCRIPTORS } from "@vestra/extension-host/permissions";
import {
  EXTENSION_TYPE_LABEL,
  EXTENSION_TYPE_SUPPORT,
  healthOf,
  isPinnedRef,
} from "@vestra/provider-sdk/marketplace";
import {
  AlertTriangle,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  Notice,
  Page,
  PageHeader,
  SectionRule,
} from "@/components/layout/page";
import {
  bridge,
  type BrowseEntry,
  type InstallCandidate,
  type InstallPlan,
} from "@/lib/bridge";

/** Matches the marker the main process puts on a folder install. */
const LOCAL_UNPACKED = "local:unpacked";

/** The folder a manifest path sits in, for either path separator. */
function folderOf(manifestPath: string): string {
  const cut = Math.max(
    manifestPath.lastIndexOf("\\"),
    manifestPath.lastIndexOf("/"),
  );
  return cut > 0 ? manifestPath.slice(0, cut) : manifestPath;
}

/** One heading on the Installed and Available tabs, with its entries. */
type KindGroup<T> = { label: string; items: T[] };

/**
 * Splits entries into Anime streaming, Manga and Other, the same split the
 * Providers tab uses. Empty groups are left out, so Other only shows when a
 * plugin or torrent entry exists.
 */
function splitByKind<T extends CategorizedExtension>(entries: T[]): KindGroup<T>[] {
  const isAnime = (type: string) => type === "onlinestream-provider";
  const isManga = (type: string) => type === "manga-provider";
  return [
    {
      label: "Anime streaming",
      items: entries.filter((entry) => isAnime(entry.type)),
    },
    {
      label: "Manga",
      items: entries.filter((entry) => isManga(entry.type)),
    },
    {
      label: "Movies & series",
      items: entries.filter(entry => extensionKinds(entry).some(k => k === "movie" || k === "tv")),
    },
    {
      label: "Other",
      items: entries.filter(
        (entry) => !isAnime(entry.type) && !isManga(entry.type) && !extensionKinds(entry).some(k => k === "movie" || k === "tv"),
      ),
    },
  ].filter((group) => group.items.length > 0);
}

/**
 * Extensions.
 *
 * The runtime for these has existed for a while — isolates, content-addressed
 * installs, brokered network — with no way to install one. This is that
 * surface: point the app at a registry, look at what a listing asks for, and
 * decide.
 *
 * Extension payloads are downloaded after review. New profiles start with the
 * Vestra catalogue; users control the saved registry list.
 *
 * Types Vestra will not run are still listed, with the reason, and cannot be
 * installed. Hiding them would suggest the registry was smaller than it is;
 * offering them would suggest the refusal is temporary.
 */
export function ExtensionsRoute() {
  const queryClient = useQueryClient();
  const [manifestUrl, setManifestUrl] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [installedMessage, setInstalledMessage] = useState("");
  const [reviewing, setReviewing] = useState<InstallPlan | null>(null);
  const [providerReview, setProviderReview] = useState<RemoteSourcePlan | null>(
    null,
  );
  const reviewRegion = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<ExtensionTab>("installed");
  useEffect(() => {
    if (providerReview) reviewRegion.current?.focus();
  }, [providerReview?.token]);
  const managed = useQuery({
    queryKey: ["managed-sources"],
    queryFn: bridge.sources.list,
  });

  const installed = useQuery({
    queryKey: ["extensions", "installed"],
    queryFn: () => bridge.extensions.installed(),
  });

  /*
    Installed and running are not the same thing. Stored code is re-verified
    against its fingerprint at startup, so an extension whose payload was
    altered on disk is present here and deliberately not loaded.
  */
  const running = useQuery({
    queryKey: ["extensions", "running"],
    queryFn: () => bridge.extensions.list(),
  });

  const registries = useQuery({
    queryKey: ["extensions", "registries"],
    queryFn: () => bridge.extensions.registries(),
  });

  const browse = useQuery({
    queryKey: ["extensions", "browse", registries.data],
    queryFn: () => bridge.extensions.browse(),
    enabled: registries.isSuccess,

  });

  const refresh = () => {
    for (const queryKey of [
      ["extensions"],
      ["managed-sources"],
      ["manga"],
      ["anime-sources"],
      ["anime-discovery"],
      ["playback"],
      ["source-episodes"],
      ["anime-source-details"],
    ])
      void queryClient.invalidateQueries({ queryKey });
  };

  const setRegistries = useMutation({
    mutationFn: (urls: string[]) => bridge.extensions.setRegistries(urls),
    onSuccess: refresh,
  });

  const prepare = useMutation({
    mutationFn: (candidate: InstallCandidate | string) =>
      bridge.extensions.prepare(candidate),
    onSuccess: (review) => {
      setInstalledMessage("");
      installProvider.reset();
      if (review.kind === "provider") {
        setReviewing(null);
        setProviderReview(review.plan);
      } else {
        setProviderReview(null);
        setReviewing(review.plan);
      }
    },
  });

  const installProvider = useMutation({
    mutationFn: ({ token, hosts }: { token: string; hosts: string[] }) =>
      bridge.sources.applyRemote(token, hosts),
    onSuccess: () => {
      setProviderReview(null);
      setInstalledMessage(
        "Provider installed. It is ready in Compatibility and your library source menu.",
      );
      setTab("providers");
      refresh();
    },
  });
  const install = useMutation({
    mutationFn: (input: { candidate: InstallCandidate; granted: string[] }) =>
      bridge.extensions.install(input),
    onSuccess: () => {
      setReviewing(null);
      setInstalledMessage("Extension installed and ready to use.");
      setTab("installed");
      refresh();
    },
  });

  /*
    Loading from a folder goes through the same review screen as a registry
    install. The consent is the part that matters, and a second prompt for the
    local case would be free to drift from the first.
  */
  const pickUnpacked = useMutation({
    mutationFn: () => bridge.extensions.pickUnpacked(),
    onSuccess: (plan) => {
      if (plan) {
        setProviderReview(null);
        setReviewing(plan);
      }
    },
  });

  const installUnpacked = useMutation({
    mutationFn: (input: { folder: string; granted: string[] }) =>
      bridge.extensions.installUnpacked(input),
    onSuccess: () => {
      setReviewing(null);
      setInstalledMessage("Extension installed and ready to use.");
      setTab("installed");
      refresh();
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      bridge.extensions.setEnabled(id, enabled),
    onSettled: refresh,
  });

  const uninstall = useMutation({
    mutationFn: (id: string) => bridge.extensions.uninstall(id),
    onSuccess: refresh,
  });

  const installedIds = new Set([
    ...(installed.data ?? []).map((entry) => entry.id),
    ...(managed.data ?? []).map((entry) => entry.id),
  ]);
  const runningIds = new Set(running.data ?? []);
  const matches = (entry: CategorizedExtension & { name: string; id: string }) =>
    `${entry.name} ${entry.id}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()) &&
    matchesExtensionCategory(entry, kind);
  const installedGroups = splitByKind((installed.data ?? []).filter(matches));
  const availableGroups = splitByKind(
    (browse.data?.entries ?? []).filter(matches),
  );
  const installing =
    prepare.isPending ||
    installProvider.isPending ||
    install.isPending ||
    installUnpacked.isPending;

  return (
    <Page>
      <PageHeader
        eyebrow="System"
        title="Extensions"
        lead="Find a source, review its permissions, and install. Your sources appear in the matching anime, manga, movie or series library."
      />

      <section
        aria-label="Add extension"
        className="mt-6 rounded-box border rule bg-base-200/40 p-4 sm:p-5"
      >
        <h2 className="font-serif text-xl">Add an extension</h2>
        <p className="mt-1 text-sm text-base-content/60">
          Paste a manifest link or choose a folder. Vestra detects the format
          for you.
        </p>
        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            prepare.mutate(manifestUrl.trim());
          }}
        >
          <label className="sr-only" htmlFor="extension-manifest-url">
            Extension manifest URL
          </label>
          <input
            id="extension-manifest-url"
            type="url"
            required
            maxLength={4096}
            value={manifestUrl}
            onChange={(event) => setManifestUrl(event.target.value)}
            placeholder="https://example.org/manifest.json"
            className="input input-bordered h-10 min-w-0 shrink-0 sm:flex-1"
          />
          <button
            className="btn btn-primary"
            disabled={installing || !manifestUrl.trim()}
          >
            {prepare.isPending ? "Checking…" : "Review installation"}
          </button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <button
            type="button"
            className="flex items-center gap-1.5 hover:text-primary disabled:opacity-40"
            disabled={installing || pickUnpacked.isPending}
            onClick={() => pickUnpacked.mutate()}
          >
            <FolderOpen className="size-4" />
            {pickUnpacked.isPending ? "Opening…" : "Choose extension folder"}
          </button>
          <button
            type="button"
            className="text-base-content/60 hover:text-primary"
            onClick={() => setTab("available")}
          >
            Browse sources
          </button>
          <button
            type="button"
            className="text-base-content/60 hover:text-primary"
            onClick={() => setTab("providers")}
          >
            Import a provider script
          </button>
        </div>
        {prepare.error && (
          <p role="alert" className="mt-3 text-sm text-error">
            {prepare.error.message}
          </p>
        )}
        {pickUnpacked.error && (
          <p role="alert" className="mt-3 text-sm text-error">
            {pickUnpacked.error.message}
          </p>
        )}
        {installedMessage && (
          <p role="status" className="mt-3 text-sm text-success">
            {installedMessage}
          </p>
        )}
      </section>

      {providerReview && (
        <div
          ref={reviewRegion}
          tabIndex={-1}
          role="region"
          aria-label="Review extension installation"
          className="mt-8"
        >
          <RemoteSourceReview
            key={providerReview.token}
            plan={providerReview}
            busy={installProvider.isPending}
            onCancel={() => setProviderReview(null)}
            onApply={(hosts) =>
              installProvider.mutate({ token: providerReview.token, hosts })
            }
          />
          {installProvider.error && (
            <p role="alert" className="text-error">
              {installProvider.error.message}
            </p>
          )}
        </div>
      )}
      <ExtensionTabs
        tab={tab}
        onChange={setTab}
        counts={{
          providers: managed.data?.length,
          installed: installed.data?.length,
          available: browse.data?.entries.length,
          registries: registries.data?.length,
        }}
      />

      {(tab === "installed" || tab === "available") && (
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <input
            id="extension-search"
            aria-label="Search extensions"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search extensions…"
            className="input input-bordered h-10 min-w-0 shrink-0 sm:flex-1"
          />
          <select
            aria-label="Extension category"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className="select select-bordered"
          >
            <option value="all">All categories</option>
            <option value="onlinestream-provider">Anime</option>
            <option value="manga-provider">Manga</option>
            <option value="movie">Movies</option>
            <option value="tv">Series</option>
            <option value="other">Other</option>
          </select>
        </div>
      )}

      <div
        role="tabpanel"
        id="ext-panel-providers"
        aria-labelledby="ext-tab-providers"
        hidden={tab !== "providers"}
        className="mt-6"
      >
        <ProviderExtensions artwork={browse.data?.entries ?? []} />
      </div>

      <div
        role="tabpanel"
        id="ext-panel-installed"
        aria-labelledby="ext-tab-installed"
        hidden={tab !== "installed"}
        className="mt-6"
      >
        <section>
          <SectionRule label="Installed" count={installed.data?.length} />

          {(installed.data ?? []).length === 0 ? (
            <Notice
              title="Nothing installed"
              body="Load a Vestra extension folder, or add a registry to browse extensions. Existing provider scripts are managed in Compatibility."
            />
          ) : (
            <div className="space-y-6">
              {installedGroups.length === 0 && (
                <Notice
                  title="No matching extensions"
                  body="Try another name or category."
                />
              )}
              {installedGroups.map((group) => (
                <div key={group.label}>
                  <SectionRule label={group.label} count={group.items.length} />
                  <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                    {group.items.map((entry) => (
                      <article
                        key={entry.id}
                        className="flex min-h-80 flex-col gap-4 rounded-box border rule bg-base-200/40 p-5"
                      >
                        <ExtensionArtwork
                          name={entry.name}
                          icon={entry.manifest.icon}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              title={
                                runningIds.has(entry.id)
                                  ? "Running"
                                  : "Not running"
                              }
                              className={`size-1.5 shrink-0 rounded-full ${
                                runningIds.has(entry.id)
                                  ? "bg-success"
                                  : "bg-base-content/25"
                              }`}
                            />
                            <p className="truncate text-sm">{entry.name}</p>
                            <span className="meta">v{entry.version}</span>
                            {entry.driftDetectedAt ? (
                              <span className="meta flex items-center gap-1 text-warning">
                                <AlertTriangle className="size-3" />
                                code changed
                              </span>
                            ) : null}
                          </div>

                          <p className="mt-2 text-sm text-base-content/60">
                            {extensionDescription(
                              entry.manifest.description,
                              entry.type,
                            )}
                          </p>
                          {entry.manifest.author && (
                            <p className="meta mt-2">
                              By {entry.manifest.author}
                            </p>
                          )}
                          <p className="filename truncate">{entry.id}</p>

                          <p className="meta mt-1 break-words">
                            {entry.grant.granted.length === 0
                              ? "No permissions"
                              : entry.grant.granted.join(" · ")}
                            {entry.grant.allowedHosts.length > 0
                              ? ` · ${entry.grant.allowedHosts.join(", ")}`
                              : ""}
                          </p>
                        </div>

                        <button
                          type="button"
                          disabled={toggle.isPending}
                          className="btn btn-sm"
                          onClick={() =>
                            toggle.mutate({
                              id: entry.id,
                              enabled: entry.enabled === false,
                            })
                          }
                        >
                          {entry.enabled === false ? "Enable" : "Disable"}
                        </button>
                        <button
                          type="button"
                          aria-label={`Uninstall ${entry.name}`}
                          disabled={uninstall.isPending}
                          onClick={() => uninstall.mutate(entry.id)}
                          className="grid size-8 shrink-0 place-items-center rounded-field text-base-content/40 transition-colors hover:bg-error hover:text-error-content"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {toggle.error && (
            <p role="alert" className="mt-3 text-sm text-error">
              {toggle.error.message}
            </p>
          )}
          {uninstall.error ? (
            <p className="mt-3 text-xs text-error">
              {(uninstall.error as Error).message}
            </p>
          ) : null}
        </section>
      </div>

      <div
        role="tabpanel"
        id="ext-panel-available"
        aria-labelledby="ext-tab-available"
        hidden={tab !== "available"}
        className="mt-6"
      >
        <section>
          <SectionRule
            label="Available"
            count={browse.data?.entries.length}
            trailing={
              <button
                type="button"
                className="btn btn-ghost btn-xs gap-1.5"
                disabled={browse.isFetching}
                onClick={() => browse.refetch()}
                aria-label="Refresh available extensions"
              >
                <RefreshCw
                  className={`size-3.5 ${browse.isFetching ? "animate-spin" : ""}`}
                />
                Refresh
              </button>
            }
          />

          {(registries.data ?? []).length === 0 && !(browse.data?.entries.length) && !browse.isFetching ? (
            <>
              <button
                className="btn btn-sm mt-3"
                onClick={() => setTab("registries")}
              >
                Add a registry
              </button>
              <Notice
                title="No registry configured"
                body="Add a registry to browse its extensions, or install directly using a manifest link above."
              />
            </>
          ) : browse.error ? (
            <Notice
              title="Could not browse"
              body={(browse.error as Error).message}
            />
          ) : (browse.data?.entries ?? []).length === 0 &&
            !browse.isFetching ? (
            <Notice
              title="Nothing listed"
              body="The registry returned no usable entries."
            />
          ) : (
            <div className="space-y-6">
              {availableGroups.length === 0 && (
                <Notice
                  title="No matching extensions"
                  body="Try another name or category."
                />
              )}
              {availableGroups.map((group) => (
                <div key={group.label}>
                  <SectionRule label={group.label} count={group.items.length} />
                  <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                    {group.items.map((entry) => (
                      <AvailableRow
                        key={`${entry.registryUrl}:${entry.id}`}
                        entry={entry}
                        installed={installedIds.has(entry.id)}
                        busy={
                          prepare.isPending ||
                          installProvider.isPending ||
                          install.isPending ||
                          installUnpacked.isPending
                        }
                        onReview={() =>
                          prepare.mutate({
                            id: entry.id,
                            name: entry.name,
                            version: entry.version,
                            type: entry.type,
                            manifestURI: entry.manifestURI,
                            payloadURI: entry.payloadURI,
                            registryUrl: entry.registryUrl,
                          })
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {browse.data?.errors.map((problem) => (
            <p key={problem.registryUrl} className="mt-3 text-xs text-error">
              {problem.registryUrl}: {problem.message}
            </p>
          ))}

          {browse.data && browse.data.rejected > 0 ? (
            <p className="meta mt-3">
              {browse.data.rejected} listing(s) skipped — malformed
            </p>
          ) : null}

          {prepare.error ? (
            <p className="mt-3 text-xs text-error">
              {(prepare.error as Error).message}
            </p>
          ) : null}
        </section>
      </div>

      <div
        role="tabpanel"
        id="ext-panel-registries"
        aria-labelledby="ext-tab-registries"
        hidden={tab !== "registries"}
        className="mt-6"
      >
        <Registries
          urls={registries.data ?? []}
          busy={setRegistries.isPending}
          error={setRegistries.error as Error | null}
          onChange={(urls) => setRegistries.mutate(urls)}
        />
      </div>

      {reviewing ? (
        <ReviewDialog
          plan={reviewing}
          busy={install.isPending || installUnpacked.isPending}
          error={(install.error ?? installUnpacked.error) as Error | null}
          onCancel={() => setReviewing(null)}
          onInstall={(granted) => {
            // Local plans carry a folder path where a registry plan carries a
            // URL, and the two install paths are not interchangeable.
            if (reviewing.candidate.registryUrl === LOCAL_UNPACKED) {
              installUnpacked.mutate({
                folder: folderOf(reviewing.candidate.manifestURI),
                granted,
              });
              return;
            }

            install.mutate({ candidate: reviewing.candidate, granted });
          }}
        />
      ) : null}
    </Page>
  );
}

/** The four sections of the Extensions page, shown one at a time. */
type ExtensionTab = "providers" | "installed" | "available" | "registries";

const EXTENSION_TABS: { id: ExtensionTab; label: string; hint: string }[] = [
  {
    id: "installed",
    label: "Installed",
    hint: "Vestra SDK extensions on this PC, their permissions and runtime status.",
  },
  {
    id: "available",
    label: "Browse",
    hint: "Extensions listed by the registries you added.",
  },
  {
    id: "registries",
    label: "Registries",
    hint: "Web addresses of the registries you trust.",
  },
  {
    id: "providers",
    label: "Compatibility",
    hint: "Optional imports for existing anime and manga provider scripts.",
  },
];

/** Tab bar that switches between the four sections. */
function ExtensionTabs({
  tab,
  counts,
  onChange,
}: {
  tab: ExtensionTab;
  counts: Record<ExtensionTab, number | undefined>;
  onChange: (tab: ExtensionTab) => void;
}) {
  const current = EXTENSION_TABS.find((entry) => entry.id === tab);

  return (
    <div className="mt-8">
      <div
        role="tablist"
        aria-label="Extension sections"
        className="grid grid-cols-2 gap-x-6 gap-y-3 border-b rule sm:flex"
      >
        {EXTENSION_TABS.map((entry) => {
          const active = entry.id === tab;
          const count = counts[entry.id];

          return (
            <button
              key={entry.id}
              id={`ext-tab-${entry.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`ext-panel-${entry.id}`}
              tabIndex={active ? 0 : -1}
              onKeyDown={(event) => {
                const index = EXTENSION_TABS.findIndex(
                  (item) => item.id === entry.id,
                );
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % EXTENSION_TABS.length
                    : event.key === "ArrowLeft"
                      ? (index + EXTENSION_TABS.length - 1) %
                        EXTENSION_TABS.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? EXTENSION_TABS.length - 1
                          : -1;
                if (next < 0) return;
                event.preventDefault();
                const target = EXTENSION_TABS[next]!;
                onChange(target.id);
                document.getElementById(`ext-tab-${target.id}`)?.focus();
              }}
              onClick={() => onChange(entry.id)}
              className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 pb-3 text-sm transition-colors ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-base-content/60 hover:text-base-content"
              }`}
            >
              {entry.label}
              {count !== undefined ? (
                <span className="meta">{count}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="meta mt-3">{current?.hint}</p>
    </div>
  );
}

/** Registry URLs the user has chosen to browse. */
function Registries({
  urls,
  busy,
  error,
  onChange,
}: {
  urls: string[];
  busy: boolean;
  error: Error | null;
  onChange: (urls: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  return (
    <section>
      <SectionRule label="Registries" count={urls.length} />

      <form
        className="mb-3 mt-4 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = draft.trim();
          if (value.length === 0) return;
          onChange([...new Set([...urls, value])]);
          setDraft("");
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="https://example.com/registry.json"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-field border rule bg-base-200/40 px-3 py-1.5 font-mono text-xs outline-none focus:border-primary/40"
        />
        <button
          type="submit"
          disabled={busy || draft.trim().length === 0}
          className="flex items-center gap-1.5 rounded-field border border-primary/40 px-2.5 py-1.5 text-xs text-primary transition-colors hover:bg-primary hover:text-primary-content disabled:opacity-40"
        >
          <Plus className="size-3.5" />
          Add
        </button>
      </form>

      {urls.length === 0 ? (
        <p className="meta">
          None added. Only https addresses are accepted, and private or loopback
          addresses are refused.
        </p>
      ) : (
        <div>
          {urls.map((url) => (
            <div
              key={url}
              className="group flex items-center gap-3 border-b rule px-2 py-2"
            >
              <span
                data-selectable
                className="min-w-0 flex-1 truncate font-mono text-[12px] text-base-content/75"
                title={url}
              >
                {url}
              </span>
              <button
                type="button"
                aria-label={`Remove ${url}`}
                onClick={() => onChange(urls.filter((entry) => entry !== url))}
                className="grid size-7 place-items-center rounded-field text-base-content/40 opacity-0 transition-all hover:bg-error hover:text-error-content group-hover:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {error ? (
        <p className="mt-3 text-xs text-error">{error.message}</p>
      ) : null}
    </section>
  );
}

/** A registry listing with a primary installation action and optional details. */
function AvailableRow({
  entry,
  installed,
  busy,
  onReview,
}: {
  entry: BrowseEntry;
  installed: boolean;
  busy: boolean;
  onReview: () => void;
}) {
  const support = EXTENSION_TYPE_SUPPORT[entry.type];
  const health = healthOf(entry);
  const installable = support.supported && entry.manifestURI.length > 0 && !entry.tags.includes("installation-blocked");
  return (
    <article className="flex aspect-square min-h-80 w-full min-w-0 flex-col has-[details[open]]:aspect-auto rounded-box border rule bg-base-200/40 p-5 transition-colors hover:border-primary/30">
      <div className="flex items-start justify-between gap-3">
        <ExtensionArtwork name={entry.name} icon={entry.icon} />
        <span className="meta rounded-selector border rule px-2 py-1">
          {EXTENSION_TYPE_LABEL[entry.type]}
        </span>
      </div>
      <h3 className="mt-4 break-words text-lg font-semibold">{entry.name}</h3>
      <p className="meta mt-1">
        v{entry.version}
        {entry.author ? ` · By ${entry.author}` : ""}
      </p>
      <p className="mt-3 line-clamp-3 text-sm text-base-content/60">
        {extensionDescription(entry.description, entry.type)}
      </p>
      {entry.tags.includes("experimental") && <p className="meta mt-2 text-warning">Experimental · upstream unavailable</p>}
      {health === "broken" && (
        <p className="meta mt-2 text-error">Reported broken</p>
      )}
      {health === "deprecated" && (
        <p className="meta mt-2 text-warning">Deprecated</p>
      )}
      {!support.supported && (
        <p className="mt-2 text-xs text-base-content/50">{support.reason}</p>
      )}
      {support.supported && !installable && (
        <p className="mt-2 text-xs text-base-content/50">
          This listing has no manifest URL. Ask its author to publish an
          installation manifest.
        </p>
      )}
      <div className="mt-auto pt-5">
        <button
          type="button"
          disabled={busy || installed || !installable}
          onClick={onReview}
          className="btn btn-primary w-full"
        >
          {installed ? "Installed" : installable ? "Install" : "Unavailable"}
        </button>
        <details className="mt-2 text-center text-xs text-base-content/60">
          <summary className="cursor-pointer rounded-field py-2 hover:text-primary">
            Review
          </summary>
          <div className="mt-2 rounded-field border rule p-3 text-left">
            <p>{extensionDescription(entry.description, entry.type)}</p>
            <p className="mt-2 break-all">ID: {entry.id}</p>
            <p className="mt-1 break-all">Registry: {entry.registryUrl}</p>
            <p className="mt-2">
              Install opens the manifest and permissions review before any
              extension is enabled.
            </p>
          </div>
        </details>
      </div>
    </article>
  );
}

/**
 * The consent step.
 *
 * Every permission starts unchecked. A prompt that arrives pre-agreed is not a
 * prompt, and an extension that genuinely needs a capability will not work
 * until it is given one — which is a better way to find out what it actually
 * uses than taking the manifest's word for it.
 */
function ReviewDialog({
  plan,
  busy,
  error,
  onCancel,
  onInstall,
}: {
  plan: InstallPlan;
  busy: boolean;
  error: Error | null;
  onCancel: () => void;
  onInstall: (granted: string[]) => void;
}) {
  const [granted, setGranted] = useState<string[]>([]);

  const toggle = (permission: string) =>
    setGranted((current) =>
      current.includes(permission)
        ? current.filter((entry) => entry !== permission)
        : [...current, permission],
    );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Install ${plan.manifest.name}`}
        className="max-h-full w-full max-w-xl overflow-y-auto rounded-box border rule bg-base-100 p-6 shadow-2xl"
      >
        <p className="meta">Install</p>
        <h2 className="mt-1 font-serif text-display-sm">
          {plan.manifest.name}
        </h2>
        <p className="filename mt-1">
          {plan.manifest.id} · v{plan.manifest.version}
        </p>

        <div className="mt-4 flex items-center gap-2">
          {plan.pinned ? (
            <span className="meta flex items-center gap-1 text-success">
              <ShieldCheck className="size-3.5" />
              pinned to a fixed commit
            </span>
          ) : (
            <span className="meta flex items-center gap-1 text-warning">
              <AlertTriangle className="size-3.5" />
              served from a branch
            </span>
          )}
        </div>

        <SectionRule label="Permissions" />
        {plan.manifest.catalogueSource === "tmdb" && (
          <p className="mt-3 text-sm">
            Uses Vestra's configured TMDb catalogue for search and episode
            metadata. Your TMDb credentials stay in Vestra.
          </p>
        )}

        {plan.requested.length === 0 ? (
          <p className="mt-3 text-xs text-base-content/60">
            Asks for nothing. It cannot reach the network or read your library.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {plan.requested.map((permission) => {
              const descriptor = PERMISSION_DESCRIPTORS[permission];
              const on = granted.includes(permission);

              return (
                <label
                  key={permission}
                  className={`flex cursor-pointer gap-3 rounded-box border px-3 py-2.5 transition-colors ${
                    on
                      ? "border-primary/40 bg-primary/5"
                      : "rule bg-base-200/30"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(permission)}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm">{descriptor.title}</span>
                    <span className="mt-0.5 block text-xs text-base-content/55">
                      {descriptor.risk}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {plan.hosts.length > 0 ? (
          <>
            <SectionRule label="Hosts it may contact" />
            <p className="filename mt-2">{plan.hosts.join(", ")}</p>
          </>
        ) : null}

        {plan.warnings.length > 0 ? (
          <>
            <SectionRule label="Worth knowing" />
            <ul className="mt-2 space-y-1.5">
              {plan.warnings.map((warning) => (
                <li key={warning} className="text-xs text-base-content/60">
                  {warning}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {error ? (
          <p className="mt-4 text-xs text-error">{error.message}</p>
        ) : null}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-field border rule px-3 py-1.5 text-xs transition-colors hover:bg-base-200"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onInstall(granted)}
            className="flex items-center gap-2 rounded-field bg-primary px-4 py-1.5 text-xs text-primary-content transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {granted.length === 0 && plan.requested.length > 0
              ? "Install with no permissions"
              : "Install"}
          </button>
        </div>
      </div>
    </div>
  );
}
