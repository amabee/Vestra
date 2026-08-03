"use client";

import * as Dialog from "@radix-ui/react-dialog";
// Subpath import: the package root pulls in the installer, which uses node:crypto
// and must never reach the client bundle.
import { PERMISSION_DESCRIPTORS } from "@vestra/extension-host/permissions";
import type { ExtensionPermission } from "@vestra/provider-sdk";
import { Badge, Button, GlassCard } from "@vestra/ui";
import { GitBranch, Globe, Lock, ShieldQuestion, TriangleAlert } from "lucide-react";
import { useState } from "react";

export interface InstallPlanView {
  requested: ExtensionPermission[];
  hosts: string[];
  pinned: boolean;
  warnings: string[];
  manifest: {
    name: string;
    version: string;
    sdkVersion: string;
    author: string | null;
    description: string | null;
  };
}

interface PermissionDialogProps {
  plan: InstallPlanView | null;
  extensionId: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (granted: ExtensionPermission[]) => void;
}

/**
 * The consent step.
 *
 * Permissions are individually deniable rather than all-or-nothing. An
 * extension that wants the network and your library index may only need the
 * first to be useful, and the only way to find out is to be able to say no to
 * the second. The install endpoint stores exactly what is agreed here.
 */
export function PermissionDialog({
  plan,
  extensionId,
  pending,
  onCancel,
  onConfirm,
}: PermissionDialogProps) {
  return (
    <Dialog.Root open={plan !== null} onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" />
        <Dialog.Content className="glass fixed left-1/2 top-1/2 z-50 flex max-h-[85dvh] w-[min(32rem,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-2xl border border-border p-6 shadow-lifted focus:outline-none">
          {plan ? (
            <Body
              plan={plan}
              extensionId={extensionId}
              pending={pending}
              onCancel={onCancel}
              onConfirm={onConfirm}
            />
          ) : (
            <Dialog.Title className="sr-only">Install extension</Dialog.Title>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Body({
  plan,
  extensionId,
  pending,
  onCancel,
  onConfirm,
}: {
  plan: InstallPlanView;
  extensionId: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (granted: ExtensionPermission[]) => void;
}) {
  // Default to granting what was asked for; unchecking is the deliberate act.
  const [granted, setGranted] = useState<ExtensionPermission[]>(plan.requested);

  const toggle = (permission: ExtensionPermission) =>
    setGranted((current) =>
      current.includes(permission)
        ? current.filter((entry) => entry !== permission)
        : [...current, permission],
    );

  return (
    <>
      <div className="space-y-1">
        <Dialog.Title className="text-base font-semibold tracking-tight">
          Install {plan.manifest.name}
        </Dialog.Title>
        <p className="font-mono text-[11px] text-muted-foreground">
          {extensionId} · v{plan.manifest.version}
          {plan.manifest.author ? ` · ${plan.manifest.author}` : ""}
        </p>
        <Dialog.Description className="sr-only">
          Review the permissions this extension is requesting before installing.
        </Dialog.Description>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {plan.pinned ? (
          <Badge variant="secondary">
            <Lock className="size-3" />
            Pinned release
          </Badge>
        ) : (
          <Badge variant="warning">
            <GitBranch className="size-3" />
            Mutable branch
          </Badge>
        )}
        <Badge variant="outline">SDK {plan.manifest.sdkVersion}</Badge>
      </div>

      {plan.warnings.length > 0 ? (
        <div className="space-y-1.5 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
            <TriangleAlert className="size-3.5" />
            Worth knowing
          </p>
          <ul className="space-y-1 text-[11px] leading-relaxed text-amber-200/80">
            {plan.warnings.map((warning) => (
              <li key={warning}>— {warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-xs font-medium">This extension is asking to:</p>

        {plan.requested.length === 0 ? (
          <GlassCard className="flex items-start gap-2 p-3 text-[11px] text-muted-foreground">
            <ShieldQuestion className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Nothing. It requests no permissions, so it cannot reach the network or read
              anything of yours.
            </span>
          </GlassCard>
        ) : (
          plan.requested.map((permission) => {
            const descriptor = PERMISSION_DESCRIPTORS[permission];
            const checked = granted.includes(permission);

            return (
              <label
                key={permission}
                className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-secondary/30 p-3 transition-colors hover:border-primary/30"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(permission)}
                  className="mt-0.5 size-3.5 shrink-0 accent-violet-500"
                />
                <span className="min-w-0 space-y-1">
                  <span className="block text-xs font-medium">{descriptor.title}</span>
                  <span className="block text-[11px] leading-relaxed text-muted-foreground">
                    {descriptor.risk}
                  </span>
                </span>
              </label>
            );
          })
        )}
      </div>

      {plan.hosts.length > 0 ? (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <Globe className="size-3.5" />
            It may contact only these hosts
          </p>
          <div className="flex flex-wrap gap-1.5">
            {plan.hosts.map((host) => (
              <Badge key={host} variant="outline" className="font-mono">
                {host}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-auto flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onConfirm(granted)} disabled={pending}>
          {granted.length === plan.requested.length
            ? "Install"
            : `Install with ${granted.length} of ${plan.requested.length}`}
        </Button>
      </div>
    </>
  );
}
