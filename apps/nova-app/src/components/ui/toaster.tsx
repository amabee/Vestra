"use client";

import { cn } from "@vestra/ui";
import { AnimatePresence, motion } from "motion/react";
import { Check, TriangleAlert, X } from "lucide-react";
import { create } from "zustand";

/**
 * Minimal toast system.
 *
 * Deliberately dependency-free: Vestra only needs transient confirmations
 * (added to watchlist, settings saved) and inline errors cover the rest.
 */

export interface Toast {
  id: string;
  message: string;
  variant: "success" | "error";
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, variant?: Toast["variant"]) => void;
  dismiss: (id: string) => void;
}

const TOAST_TTL_MS = 3000;

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],

  push: (message, variant = "success") => {
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [...state.toasts, { id, message, variant }] }));
    setTimeout(() => get().dismiss(id), TOAST_TTL_MS);
  },

  dismiss: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

/** Convenience wrapper so callers don't reach into the store directly. */
export function toast(message: string, variant: Toast["variant"] = "success"): void {
  useToastStore.getState().push(message, variant);
}

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    <div
      // aria-live so screen readers announce confirmations.
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 right-5 z-[60] flex flex-col gap-2"
    >
      <AnimatePresence initial={false}>
        {toasts.map((entry) => (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "glass-strong pointer-events-auto flex items-center gap-2.5 rounded-xl py-2.5 pl-3 pr-2.5 shadow-lifted",
              "min-w-56 max-w-sm",
            )}
          >
            {entry.variant === "success" ? (
              <Check className="size-4 shrink-0 text-emerald-400" />
            ) : (
              <TriangleAlert className="size-4 shrink-0 text-amber-400" />
            )}

            <span className="flex-1 text-[13px]">{entry.message}</span>

            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(entry.id)}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
