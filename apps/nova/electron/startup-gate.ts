import {
  STARTUP_STEPS,
  type StartupState,
  type StartupStep,
  type StartupStatus,
} from "../shared/startup";

/** Local readiness gates the window; optional network work has a bounded wait. */
export class StartupGate {
  private state: StartupState;
  private painted = false;
  private timer: ReturnType<typeof setTimeout>;
  private coreTimer: ReturnType<typeof setTimeout>;
  constructor(
    version: string,
    private publish: (state: StartupState) => void,
    private open: () => void,
    waitMs = 7000,
    coreWaitMs = 20000,
  ) {
    this.state = {
      version,
      steps: {
        config: "loading",
        cache: "waiting",
        extensions: "waiting",
        updates: "waiting",
      },
      update: "checking",
      canContinue: false,
      error: false,
      opened: false,
    };
    this.timer = setTimeout(() => {
      for (const step of ["extensions", "updates"] as const)
        if (["waiting", "loading"].includes(this.state.steps[step]))
          this.state.steps[step] = "background";
      this.changed();
    }, waitMs);
    this.coreTimer = setTimeout(() => {
      if (!this.state.opened) this.fail();
    }, coreWaitMs);
  }
  snapshot(): StartupState {
    return structuredClone(this.state);
  }
  step(step: StartupStep, status: StartupStatus) {
    if (this.state.opened || this.state.error) return;
    // A late start must not reset an optional step already moved to background.
    if (this.state.steps[step] === "background" && status === "loading") return;
    this.state.steps[step] = status;
    this.changed();
  }
  update(value: StartupState["update"]) {
    this.state.update = value;
    this.step(
      "updates",
      value === "checking"
        ? "loading"
        : value === "offline"
          ? "warning"
          : "ready",
    );
  }
  rendererReady(warnings = 0) {
    this.painted = true;
    this.step("cache", warnings ? "warning" : "ready");
  }
  fail() {
    if (!this.state.opened) {
      this.state.error = true;
      this.changed();
    }
  }
  continue() {
    if (!this.state.canContinue || this.state.opened) return false;
    this.state.opened = true;
    clearTimeout(this.timer);
    clearTimeout(this.coreTimer);
    this.publish(this.snapshot());
    this.open();
    return true;
  }
  dispose() {
    clearTimeout(this.timer);
    clearTimeout(this.coreTimer);
  }
  private changed() {
    this.state.canContinue =
      !this.state.error &&
      this.painted &&
      ["ready", "warning"].includes(this.state.steps.config);
    this.publish(this.snapshot());
    if (
      this.state.canContinue &&
      STARTUP_STEPS.every(
        (step) => !["waiting", "loading"].includes(this.state.steps[step]),
      )
    )
      this.continue();
  }
}
