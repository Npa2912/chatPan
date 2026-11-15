"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
// Radix-backed dialog, styled locally following the shadcn/ui ownership pattern.
export function Dialog({
  title,
  onClose,
  children,
  className = "modal",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Portal
        container={
          typeof document === "undefined"
            ? undefined
            : (document.querySelector(".app") as HTMLElement)
        }
      >
        <DialogPrimitive.Overlay className="modal-backdrop">
          <DialogPrimitive.Content
            className={className}
            aria-describedby={undefined}
          >
            <DialogPrimitive.Title className="sr-only">
              {title}
            </DialogPrimitive.Title>
            {children}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
