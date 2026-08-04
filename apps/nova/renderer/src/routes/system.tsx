import { Notice, Page, PageHeader, SectionRule } from "@/components/layout/page";
import { useDiagnostics, useSettings } from "@/lib/queries";

/**
 * Settings.
 *
 * Read-only for now, and honest about it. Provider credentials come from the
 * environment rather than the UI, so the useful thing this screen can do today
 * is tell you what is actually connected — which is the question you have when
 * a section comes up empty.
 */
export function SettingsRoute() {
  const { data: diagnostics } = useDiagnostics();
  const { data: settings } = useSettings();

  return (
    <Page>
      <PageHeader
        eyebrow="System"
        title="Settings"
        lead="Connections are configured through environment variables and never stored in the app."
      />

      <section className="mt-10">
        <SectionRule label="Sources" count={diagnostics?.providers.length} />
        <div>
          {(diagnostics?.providers ?? []).map((provider) => (
            <div
              key={provider.id}
              className="flex items-center justify-between gap-4 border-b rule px-2 py-3"
            >
              <div className="flex items-center gap-3">
                <span
                  className={[
                    "size-1.5 rounded-full",
                    provider.available ? "bg-success" : "bg-base-300",
                  ].join(" ")}
                />
                <span className="text-sm">{provider.name}</span>
              </div>
              <span className="meta">
                {provider.available ? "ready" : "not configured"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <SectionRule label="Storage" />
        <Row label="Data directory" value={diagnostics?.dataDir ?? "—"} mono />
        <Row label="Files indexed" value={String(diagnostics?.counts.localFiles ?? 0)} />
        <Row label="On watchlist" value={String(diagnostics?.counts.watchlist ?? 0)} />
        <Row
          label="Media folders"
          value={String(settings?.library.folders.length ?? 0)}
        />
      </section>

      <section className="mt-10">
        <SectionRule label="Playback" />
        <Row
          label="Mark watched at"
          value={`${Math.round((settings?.playback.markWatchedAt ?? 0.9) * 100)}%`}
        />
        <Row
          label="Autoplay next"
          value={settings?.playback.autoplayNext ? "on" : "off"}
        />
        <Row
          label="Seek step"
          value={`${settings?.playback.seekStepSeconds ?? 10}s`}
        />
      </section>
    </Page>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b rule px-2 py-2.5">
      <span className="text-sm text-base-content/60">{label}</span>
      <span
        data-selectable
        className={[
          "truncate text-right text-sm",
          mono ? "font-mono text-[12px] text-base-content/75" : "",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

/* =============================================================================
 * Extensions
 * ========================================================================== */

export function ExtensionsRoute() {
  const { data: diagnostics } = useDiagnostics();
  const loaded = diagnostics?.extensions ?? [];

  return (
    <Page>
      <PageHeader
        eyebrow="System"
        title="Extensions"
        lead="Community extensions run in an isolate with no filesystem access and no network beyond the hosts you allow."
      />

      <section className="mt-10">
        <SectionRule label="Loaded" count={loaded.length} />
        {loaded.length === 0 ? (
          <Notice
            title="No extensions installed"
            body="The runtime is built and the isolate works, but there is no install surface in this UI yet."
          />
        ) : (
          <div>
            {loaded.map((id) => (
              <div key={id} className="flex items-center gap-3 border-b rule px-2 py-3">
                <span className="size-1.5 rounded-full bg-success" />
                <span className="font-mono text-[13px]">{id}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </Page>
  );
}
