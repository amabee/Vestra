import {
  completeInstall,
  ExtensionRefusedError,
  InstallError,
  prepareInstall,
  saveInstalled,
  type InstallCandidate,
} from "@vestra/extension-host";
import { extensionTypeSchema } from "@vestra/provider-sdk";
import { NextResponse } from "next/server";
import { z } from "zod";

import { guardedTransport } from "@/lib/extension-transport";
import { getDriver } from "@/lib/storage";

import { blockedOnWeb } from "../guard";

/**
 * Two-phase install.
 *
 * `prepare` fetches only the manifest and reports what the extension asks for.
 * `commit` runs after the user has agreed and fetches the code. Splitting them
 * is what makes consent meaningful — a single endpoint would have to either
 * prompt before knowing what it was prompting about, or download first and ask
 * afterwards.
 *
 * Neither phase executes anything. Running extensions needs an isolate, which
 * does not exist yet.
 */

export const dynamic = "force-dynamic";

const candidateSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  version: z.string().max(40),
  type: extensionTypeSchema,
  manifestURI: z.string().url().max(2048),
  payloadURI: z.string().url().max(2048),
  registryUrl: z.string().url().max(2048),
});

const requestSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("prepare"), candidate: candidateSchema }),
  z.object({
    phase: z.literal("commit"),
    candidate: candidateSchema,
    granted: z
      .array(z.enum(["network", "library:read", "progress:read"]))
      .max(8)
      .default([]),
  }),
]);

export async function POST(request: Request) {
  const blocked = blockedOnWeb();
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid install request." }, { status: 400 });
  }

  const candidate: InstallCandidate = parsed.data.candidate;

  try {
    const plan = await prepareInstall(candidate, guardedTransport);

    if (parsed.data.phase === "prepare") {
      return NextResponse.json({
        plan: {
          requested: plan.requested,
          hosts: plan.hosts,
          pinned: plan.pinned,
          warnings: plan.warnings,
          manifest: {
            name: plan.manifest.name,
            version: plan.manifest.version,
            sdkVersion: plan.manifest.sdkVersion,
            author: plan.manifest.author ?? null,
            description: plan.manifest.description ?? null,
          },
        },
      });
    }

    const { record, source } = await completeInstall(
      plan,
      parsed.data.granted,
      guardedTransport,
    );
    const installed = await saveInstalled(getDriver(), record, source);

    return NextResponse.json({ installed });
  } catch (error) {
    // A refusal is a policy outcome, not a failure — 403 so the UI can say why.
    if (error instanceof ExtensionRefusedError) {
      return NextResponse.json({ error: error.reason }, { status: 403 });
    }

    if (error instanceof InstallError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }

    return NextResponse.json(
      { error: "Could not install that extension." },
      { status: 500 },
    );
  }
}
