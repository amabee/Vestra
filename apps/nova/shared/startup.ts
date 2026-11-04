export const STARTUP_STEPS = [
  "config",
  "cache",
  "extensions",
  "updates",
] as const;
export type StartupStep = (typeof STARTUP_STEPS)[number];
export type StartupStatus =
  "waiting" | "loading" | "ready" | "warning" | "background";
export interface StartupState {
  version: string;
  steps: Record<StartupStep, StartupStatus>;
  update: "checking" | "current" | "available" | "offline" | "disabled";
  canContinue: boolean;
  error: boolean;
  opened: boolean;
}
