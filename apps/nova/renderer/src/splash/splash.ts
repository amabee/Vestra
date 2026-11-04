import type { StartupState, StartupStep } from "../../../shared/startup";

interface SplashBridge {
  state(): Promise<StartupState>;
  onChanged(listener: (state: StartupState) => void): () => void;
  continue(): Promise<unknown>;
  retry(): Promise<unknown>;
  quit(): Promise<unknown>;
}
declare global {
  interface Window {
    novaStartup?: SplashBridge;
  }
}
const api = window.novaStartup;
const message = document.querySelector<HTMLParagraphElement>("#message")!;
const open = document.querySelector<HTMLButtonElement>("#continue")!;
const retry = document.querySelector<HTMLButtonElement>("#retry")!;
const progress = document.querySelector<HTMLProgressElement>("#progress")!;
const statuses = {
  waiting: "Next",
  loading: "Loading",
  ready: "Ready",
  warning: "Check in app",
  background: "In background",
};
function render(state: StartupState) {
  document.querySelector("#version")!.textContent =
    `Vestra Nova ${state.version}`;
  let completed = 0;
  for (const [step, status] of Object.entries(state.steps)) {
    const row = document.querySelector<HTMLElement>(`[data-step="${step}"]`);
    if (!row) continue;
    row.dataset.status = status;
    row.querySelector("small")!.textContent =
      step === "updates" && status === "ready"
        ? state.update === "available"
          ? "Update available"
          : state.update === "disabled"
            ? "Manual updates"
            : "Up to date"
        : statuses[status];
    if (["ready", "warning"].includes(status)) completed++;
  }
  progress.value = completed;
  open.hidden = !state.canContinue || state.opened;
  retry.hidden = !state.error;
  if (state.error)
    message.textContent = "Startup couldn't finish. Restart Nova to try again.";
  else if (state.opened)
    message.textContent = "All yours. Let's find something good.";
  else {
    const active = (Object.keys(state.steps) as StartupStep[]).find(
      (step) => state.steps[step] === "loading",
    );
    message.textContent =
      active === "config"
        ? "Making it feel like your Nova."
        : active === "cache"
          ? "Finding where you left off."
          : active === "extensions"
            ? "Getting your sources together."
            : active === "updates"
              ? "Checking for a newer Nova."
              : state.update === "available"
                ? "A newer Nova is waiting inside."
                : "Your stories are almost ready.";
  }
}
if (api) {
  let received = false;
  const unsubscribe = api.onChanged((state) => {
    received = true;
    render(state);
  });
  void api
    .state()
    .then((state) => {
      if (!received) render(state);
    })
    .catch(() => {
      message.textContent =
        "Couldn't read startup progress. Restart Nova to try again.";
      retry.hidden = false;
    });
  window.addEventListener("pagehide", unsubscribe, { once: true });
}
async function action(
  button: HTMLButtonElement,
  call: (() => Promise<unknown>) | undefined,
) {
  if (!call) return;
  button.disabled = true;
  try {
    await call();
  } catch {
    message.textContent = "That didn't work. Please close and restart Nova.";
  } finally {
    button.disabled = false;
  }
}
open.addEventListener("click", () => void action(open, api?.continue));
retry.addEventListener("click", () => void action(retry, api?.retry));
document
  .querySelector<HTMLButtonElement>("#quit")!
  .addEventListener(
    "click",
    (event) => void action(event.currentTarget as HTMLButtonElement, api?.quit),
  );
document
  .querySelector<HTMLButtonElement>("#motion")!
  .addEventListener("click", (event) => {
    const paused = document.body.classList.toggle("paused");
    const button = event.currentTarget as HTMLButtonElement;
    button.textContent = paused ? "Resume motion" : "Pause motion";
    button.setAttribute("aria-pressed", String(paused));
  });
