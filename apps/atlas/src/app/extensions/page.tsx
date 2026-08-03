import { listInstalled } from "@vestra/extension-host";
import { getSettings } from "@vestra/storage";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ExtensionsClient } from "@/components/extensions/extensions-client";
import { extensionsEnabled } from "@/lib/host";
import { getDriver } from "@/lib/storage";

export const metadata: Metadata = { title: "Extensions" };
export const dynamic = "force-dynamic";

export default async function ExtensionsPage() {
  // Desktop-only. On the web this route does not exist at all rather than
  // rendering a disabled version of itself.
  if (!extensionsEnabled()) notFound();

  const driver = getDriver();
  const [settings, installed] = await Promise.all([
    getSettings(driver),
    listInstalled(driver),
  ]);

  return (
    <ExtensionsClient
      initialRegistries={settings.extensions.registries}
      initialInstalled={installed}
    />
  );
}
