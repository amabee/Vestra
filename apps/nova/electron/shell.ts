/**
 * Diagnostics shell.
 *
 * Not the application — a stand-in that exercises the preload bridge so the IPC
 * layer can be verified before any real UI exists. If this page renders a
 * provider list, then the bridge, the channel registration, the composition
 * root and the storage driver are all working.
 */

interface DiagnosticsReport {
  dataDir: string;
  providers: { id: string; name: string; available: boolean }[];
  adapters: string[];
  extensions: string[];
  counts: { watchlist: number; localFiles: number };
  theme: string;
}

interface VestraBridge {
  app: {
    getVersion: () => Promise<unknown>;
    diagnostics: () => Promise<unknown>;
  };
}

declare global {
  interface Window {
    vestra?: VestraBridge;
  }
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function row(label: string, value: string): HTMLElement {
  const wrapper = el("div", "row");
  wrapper.append(el("span", "label", label), el("span", "value", value));
  return wrapper;
}

async function render(): Promise<void> {
  const target = document.querySelector("#report");
  if (!target) return;

  const bridge = window.vestra;
  if (!bridge) {
    target.append(el("p", "error", "The preload bridge is not available."));
    return;
  }

  let version: unknown;
  let report: DiagnosticsReport;

  try {
    [version, report] = await Promise.all([
      bridge.app.getVersion(),
      bridge.app.diagnostics() as Promise<DiagnosticsReport>,
    ]);
  } catch (error) {
    target.append(
      el("p", "error", error instanceof Error ? error.message : "Diagnostics failed."),
    );
    return;
  }

  target.append(el("p", "ok", "IPC bridge responding"));

  // Echoed to the terminal via the main process, so a launch can be verified
  // without opening devtools.
  console.info(
    `diagnostics ok — ${report.providers.length} providers, ` +
      `${report.adapters.length} adapters, ${report.counts.watchlist} watchlist items, ` +
      `${report.counts.localFiles} local files, data dir ${report.dataDir}`,
  );

  const grid = el("div", "grid");
  grid.append(
    row("Version", String(version)),
    row("Theme", report.theme),
    row("Watchlist", `${report.counts.watchlist} items`),
    row("Local files", `${report.counts.localFiles} indexed`),
    row("Extensions", report.extensions.length > 0 ? report.extensions.join(", ") : "none"),
    row("Adapters", String(report.adapters.length)),
  );
  target.append(grid);

  const providers = el("div", "providers");
  providers.append(el("p", "heading", "Providers"));

  for (const provider of report.providers) {
    const item = el("div", `provider ${provider.available ? "on" : "off"}`);
    item.append(el("span", "dot"), el("span", "name", provider.name));
    item.append(el("span", "state", provider.available ? "ready" : "not configured"));
    providers.append(item);
  }

  target.append(providers);
  target.append(el("p", "path", report.dataDir));
}

void render();
