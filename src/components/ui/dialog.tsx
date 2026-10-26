"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOverlayFocus } from "./use-overlay-focus";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "portal-backdrop fixed inset-0 z-50 bg-scrim",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onEscapeKeyDown,
  onPointerDownOutside,
  onInteractOutside,
  dismissible = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { dismissible?: boolean }) {
  const { captureFocus, restoreFocus } = useOverlayFocus();

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        onOpenAutoFocus={(event) => {
          captureFocus();
          onOpenAutoFocus?.(event);
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          restoreFocus(event);
        }}
        onEscapeKeyDown={(event) => {
          onEscapeKeyDown?.(event);
          if (!dismissible) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          onPointerDownOutside?.(event);
          if (!dismissible) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          onInteractOutside?.(event);
          if (!dismissible) event.preventDefault();
        }}
        // 좁은 화면은 아래에서 올라오는 시트(위 모서리 16·손잡이 36×4), 넓은 화면은 가운데 패널(r10).
        className={cn(
          "portal-dialog fixed inset-x-0 bottom-0 z-50 max-h-[calc(100dvh-3rem)] overflow-y-auto overscroll-contain rounded-t-xl border border-b-0 border-border bg-background px-5 pb-[calc(2.125rem+env(safe-area-inset-bottom))] pt-2 shadow-sheet md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-[calc(100%-2rem)] md:max-w-md md:max-h-[calc(100dvh-2rem)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:border-b md:p-6 md:shadow-overlay",
          className,
        )}
        {...props}
      >
        <span aria-hidden="true" className="mx-auto mb-3 block h-1 w-9 rounded-full bg-border md:hidden" />
        {children}
        <DialogPrimitive.Close type="button" disabled={!dismissible} className="absolute right-2 top-3 flex size-11 items-center justify-center rounded-touch text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none disabled:opacity-40 md:top-2 md:size-8 md:rounded-md">
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">닫기</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("mb-4 flex flex-col gap-1", className)} {...props} />
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("pr-10 text-dialog font-semibold text-foreground", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-ui text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
};
