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

  const settings = await getSettings(getDriver());

  return (
    <ExtensionsClient
      initialRegistries={settings.extensions.registries}
      initialInstalled={settings.extensions.enabled}
    />
  );
}
