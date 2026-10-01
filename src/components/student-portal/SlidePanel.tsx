/**
 * @file src/components/student-portal/SlidePanel.tsx
 * @description 우측 슬라이드인 상세 패널 (Radix Dialog 기반).
 * 너비 480px (모바일 100vw). 반투명 백드롭으로 컨텍스트 유지.
 */
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useOverlayFocus } from "@/components/ui/use-overlay-focus";

interface SlidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  /** 기본 480px, 넓은 콘텐츠는 "lg"(640px), 에디터 폼은 "xl"(768px) 사용 */
  size?: "md" | "lg" | "xl";
  /** false면 서버 제출/업로드 중 닫기·Escape·바깥 클릭을 막는다. */
  dismissible?: boolean;
  children: React.ReactNode;
}

export function SlidePanel({
  open,
  onOpenChange,
  title,
  size = "md",
  dismissible = true,
  children,
}: SlidePanelProps) {
  const { captureFocus, restoreFocus } = useOverlayFocus();
  const widthClass = size === "xl" ? "w-full max-w-3xl" : size === "lg" ? "w-full max-w-2xl" : "w-full max-w-lg";

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !dismissible) return;
        onOpenChange(nextOpen);
      }}
    >
      <Dialog.Portal>
        {/* 반투명 백드롭 */}
        <Dialog.Overlay className="portal-backdrop fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]" />

        {/* 슬라이드 패널 */}
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={captureFocus}
          onCloseAutoFocus={restoreFocus}
          onEscapeKeyDown={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (!dismissible) event.preventDefault();
          }}
          className={`
            portal-panel fixed right-0 top-0 z-50 h-[100dvh] ${widthClass}
            bg-background border-l border-border shadow-overlay
            flex flex-col
          `}
        >
          {/* 패널 헤더 */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
            <Dialog.Title className="text-sm font-semibold text-foreground">
              {title ?? "상세 보기"}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="size-9 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                aria-label="닫기"
                disabled={!dismissible}
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          {/* 패널 콘텐츠 */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
