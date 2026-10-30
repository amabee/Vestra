import type { InstallPlan } from "@vestra/extension-host/install";
import type { RemoteSourcePlan } from "./sources";
export type ExtensionReview =
  | { kind: "sdk"; plan: InstallPlan }
  | { kind: "provider"; plan: RemoteSourcePlan };
