/**
 * @file src/components/student-portal/SlidePanel.tsx
 * @description 오른쪽에 붙는 상세 패널(Radix Dialog). 캔버스 Calendar 보드의 노트 패널 모양:
 * 흰 면·왼쪽 1px 선, 52px 머리(왼쪽 상태·유형, 오른쪽 조작과 닫기), 본문 32px 여백. 좁은 화면은 화면 가득.
 */
"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useOverlayFocus } from "@/components/ui/use-overlay-focus";
import { cn } from "@/lib/utils";

/** 본문이 패널 머리 오른쪽(닫기 왼쪽)에 조작을 둘 자리. 패널 밖에서 쓰면 null이다. */
const SlidePanelHeaderSlotContext = createContext<HTMLElement | null>(null);

export function useSlidePanelHeaderSlot(): HTMLElement | null {
  return useContext(SlidePanelHeaderSlotContext);
}

interface SlidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 대화상자의 이름. headerStart가 있으면 화면에서는 숨기고 읽기 전용 이름으로만 쓴다. */
  title?: string;
  /** 머리 왼쪽에 보일 내용(유형 점·학생 칩 등). 없으면 title을 보인다. */
  headerStart?: ReactNode;
  /** md 440px(일정 상세), note 520px(노트 패널), lg 672px, xl 768px(에디터 폼). 좁은 화면은 모두 가득. */
  size?: "md" | "note" | "lg" | "xl";
  /** false면 서버 제출/업로드 중 닫기·Escape·바깥 클릭을 막는다. */
  dismissible?: boolean;
  children: React.ReactNode;
}

const WIDTH: Record<NonNullable<SlidePanelProps["size"]>, string> = {
  md: "md:max-w-[440px]",
  note: "md:max-w-[520px]",
  lg: "md:max-w-2xl",
  xl: "md:max-w-3xl",
};

export function SlidePanel({
  open,
  onOpenChange,
  title,
  headerStart,
  size = "md",
  dismissible = true,
  children,
}: SlidePanelProps) {
  const { captureFocus, restoreFocus } = useOverlayFocus();
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !dismissible) return;
        onOpenChange(nextOpen);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="portal-backdrop fixed inset-0 z-40 bg-scrim" />

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
          className={cn(
            "portal-panel fixed inset-y-0 right-0 z-50 flex h-[100dvh] w-full flex-col bg-background md:border-l md:border-border md:shadow-[-12px_0_32px_rgb(24_24_27/0.06)]",
            WIDTH[size],
          )}
        >
          <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-muted pl-5 pr-1 md:pl-6 md:pr-4">
            {headerStart ? (
              <>
                <Dialog.Title className="sr-only">{title ?? "상세 보기"}</Dialog.Title>
                <div className="flex min-w-0 items-center gap-2">{headerStart}</div>
              </>
            ) : (
              <Dialog.Title className="min-w-0 truncate text-ui font-semibold text-foreground">
                {title ?? "상세 보기"}
              </Dialog.Title>
            )}
            <div className="flex shrink-0 items-center gap-0.5">
              <span ref={setHeaderSlot} className="contents" />
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="flex size-11 items-center justify-center rounded-touch text-secondary-foreground transition-colors duration-[var(--duration-fast)] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 motion-reduce:transition-none md:size-8 md:rounded-md"
                  aria-label="닫기"
                  disabled={!dismissible}
                >
                  <X className="size-4" strokeWidth={1.6} aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
          </div>

          <SlidePanelHeaderSlotContext.Provider value={headerSlot}>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-10 pt-6 md:px-8 md:pt-8">{children}</div>
          </SlidePanelHeaderSlotContext.Provider>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
