import type { InstallPlan } from "@vestra/extension-host/install";
export interface ExtensionUpdateSummary {
  id: string;
  name: string;
  kind: "sdk" | "provider";
  status: "available" | "current" | "local" | "error";
  currentVersion: string;
  version?: string;
  message: string;
}
export interface ExtensionUpdateReview {
  token: string;
  id: string;
  currentVersion: string;
  version: string;
  changed: boolean;
  enabled: boolean;
  retainedPermissions: string[];
  addedPermissions: string[];
  addedHosts: string[];
  plan: InstallPlan;
}
