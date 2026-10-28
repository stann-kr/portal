/**
 * @file src/components/student-portal/SlidePanel.tsx
 * @description 오른쪽 상세 패널. 캔버스 Calendar 보드의 노트 패널 모양:
 * 흰 면·왼쪽 1px 선, 52px 머리(왼쪽 상태·유형, 오른쪽 조작과 닫기), 본문 32px 여백.
 *
 * - `docked` + `SlidePanelDock` 안 + 넓은 화면: 캘린더 옆에 붙는 비모달 `<aside>`. 뒤 화면을 어둡게 하지 않고
 *   화면은 계속 조작할 수 있으며, 패널이 차지한 만큼 캘린더 폭이 줄어든다.
 * - 그 밖(좁은 화면·dock 밖·Q&A 작성처럼 docked가 아닌 패널): Radix Dialog 모달. 좁은 화면은 화면 가득.
 */
"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode, useMemo } from "react";
import { createPortal } from "react-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useOverlayFocus } from "@/components/ui/use-overlay-focus";
import { cn } from "@/lib/utils";

type HeaderSlots = { start: HTMLElement | null; end: HTMLElement | null };

/** 본문이 패널 머리 왼쪽(저장 상태·유형)과 오른쪽(닫기 왼쪽 조작)에 내용을 둘 자리. 패널 밖에서 쓰면 둘 다 null이다. */
const SlidePanelHeaderSlotContext = createContext<HeaderSlots>({ start: null, end: null });

export function useSlidePanelHeaderSlots(): HeaderSlots {
  return useContext(SlidePanelHeaderSlotContext);
}

/** 비모달 패널을 붙일 자리와 지금 붙일 수 있는지. `SlidePanelDock`이 준다. host가 없거나 enabled가 false면 모달로 연다. */
const SlidePanelDockContext = createContext<{ host: HTMLElement | null; enabled: boolean }>({ host: null, enabled: false });

/**
 * 화면 내용과 그 옆의 비모달 상세 패널 자리를 한 줄로 놓는다. 패널 자리는 `display: contents`라
 * 패널이 이 줄의 flex 항목이 된다. `enabled`가 false(좁은 화면)면 docked 패널도 모달 시트로 연다.
 */
export function SlidePanelDock({
  enabled = true,
  className,
  children,
  ...props
}: {
  enabled?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  return (
    <SlidePanelDockContext.Provider value={useMemo(() => ({ host, enabled }), [host, enabled])}>
      <div className={className} {...props}>
        {children}
        <div ref={setHost} className="contents" data-slide-panel-dock="" />
      </div>
    </SlidePanelDockContext.Provider>
  );
}

interface SlidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 패널의 이름. headerStart가 있으면 화면에서는 숨기고 읽기 전용 이름으로만 쓴다. */
  title?: string;
  /** 머리 왼쪽에 보일 내용(유형 점·학생 칩 등). 주면 title은 화면에서 숨긴다. */
  headerStart?: ReactNode;
  /** 모달일 때 넓은 화면 폭: md 440px(일정 상세), note 520px(노트 패널), lg 672px, xl 768px(에디터 폼). 좁은 화면은 모두 가득. */
  size?: "md" | "note" | "lg" | "xl";
  /** false면 서버 제출/업로드 중 닫기·Escape·바깥 클릭을 막는다. */
  dismissible?: boolean;
  /** `SlidePanelDock` 안의 넓은 화면에서 캘린더 옆 비모달 패널로 연다(캔버스 Calendar 보드). */
  docked?: boolean;
  /** docked 패널에서 보여 주는 항목이 바뀌면 초점을 다시 패널로 옮기고 돌아갈 자리를 새로 잡는다. */
  contentKey?: string;
  children: React.ReactNode;
}

const WIDTH: Record<NonNullable<SlidePanelProps["size"]>, string> = {
  md: "md:max-w-[440px]",
  note: "md:max-w-[520px]",
  lg: "md:max-w-2xl",
  xl: "md:max-w-3xl",
};

const CLOSE_BUTTON =
  "flex size-11 items-center justify-center rounded-touch text-secondary-foreground transition-colors duration-[var(--duration-fast)] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 motion-reduce:transition-none md:size-8 md:rounded-md";

/** 52px 머리: 왼쪽(start 자리·headerStart 또는 제목), 오른쪽(end 자리·닫기). 모달과 docked가 같이 쓴다. */
function PanelHeader({
  title,
  headerStart,
  closeButton,
  onStartSlot,
  onEndSlot,
}: {
  title: ReactNode;
  headerStart?: ReactNode;
  closeButton: ReactNode;
  onStartSlot: (node: HTMLElement | null) => void;
  onEndSlot: (node: HTMLElement | null) => void;
}) {
  return (
    <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-muted pl-5 pr-1 md:pl-6 md:pr-4">
      <div className="flex min-w-0 items-center gap-2">
        <span ref={onStartSlot} className="contents" />
        {headerStart !== undefined ? headerStart : null}
        {title}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <span ref={onEndSlot} className="contents" />
        {closeButton}
      </div>
    </div>
  );
}

const BODY = "min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-10 pt-6 md:px-8 md:pt-8";

export function SlidePanel(props: SlidePanelProps) {
  const { host, enabled } = useContext(SlidePanelDockContext);
  const wantDocked = Boolean(props.docked && host && enabled);
  // 저장·삭제 중(dismissible=false)에 화면 폭이 1280px 경계를 넘어도 표현을 바꾸지 않는다. 바꾸면 본문이 다시
  // 마운트되어 진행 중 잠금과 편집 상태가 사라진다. 작업이 끝나면 지금 폭에 맞는 표현으로 옮긴다.
  const [docked, setDocked] = useState(wantDocked);
  if (props.dismissible !== false && docked !== wantDocked) setDocked(wantDocked);
  return docked && host ? <DockedPanel {...props} host={host} /> : <ModalPanel {...props} />;
}

function ModalPanel({
  open,
  onOpenChange,
  title,
  headerStart,
  size = "md",
  dismissible = true,
  children,
}: SlidePanelProps) {
  const { captureFocus, restoreFocus } = useOverlayFocus();
  const [startSlot, setStartSlot] = useState<HTMLElement | null>(null);
  const [endSlot, setEndSlot] = useState<HTMLElement | null>(null);

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
          <PanelHeader
            headerStart={headerStart}
            title={headerStart !== undefined ? (
              <Dialog.Title className="sr-only">{title ?? "상세 보기"}</Dialog.Title>
            ) : (
              <Dialog.Title className="min-w-0 truncate text-ui font-semibold text-foreground">
                {title ?? "상세 보기"}
              </Dialog.Title>
            )}
            onStartSlot={setStartSlot}
            onEndSlot={setEndSlot}
            closeButton={(
              <Dialog.Close asChild>
                <button type="button" className={CLOSE_BUTTON} aria-label="닫기" disabled={!dismissible}>
                  <X className="size-4" strokeWidth={1.6} aria-hidden="true" />
                </button>
              </Dialog.Close>
            )}
          />

          <SlidePanelHeaderSlotContext.Provider value={{ start: startSlot, end: endSlot }}>
            <div className={BODY}>{children}</div>
          </SlidePanelHeaderSlotContext.Provider>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * 캘린더 옆 비모달 패널(complementary). 열 때와 다른 항목으로 바뀔 때 초점을 패널로 옮기고,
 * 초점이 패널 안에 있는 채로 닫히면 연 요소로 돌려준다. 사용자가 패널 밖으로 옮긴 초점은 건드리지 않는다.
 * Esc는 초점이 패널 안에 있을 때만 닫고, 저장·삭제 중(dismissible=false)에는 닫기와 Esc를 막는다.
 */
function DockedPanel({
  open,
  onOpenChange,
  title,
  headerStart,
  dismissible = true,
  contentKey,
  children,
  host,
}: SlidePanelProps & { host: HTMLElement }) {
  const panelRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const focusInsideRef = useRef(false);
  const wasOpenRef = useRef(false);
  const [startSlot, setStartSlot] = useState<HTMLElement | null>(null);
  const [endSlot, setEndSlot] = useState<HTMLElement | null>(null);
  const label = title ?? "상세 보기";

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      const panel = panelRef.current;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && !panel?.contains(active)) {
        returnFocusRef.current = active;
      }
      panel?.focus({ preventScroll: true });
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    // 패널이 사라지면서 안의 초점이 문서로 빠졌을 때만 연 요소로 돌려준다.
    const target = returnFocusRef.current;
    const active = document.activeElement;
    const focusWasInside = focusInsideRef.current;
    returnFocusRef.current = null;
    focusInsideRef.current = false;
    if (focusWasInside && target?.isConnected && (!active || active === document.body)) {
      target.focus({ preventScroll: true });
    }
  }, [open, contentKey]);

  if (!open) return null;

  return createPortal(
    <aside
      ref={panelRef}
      aria-label={label}
      tabIndex={-1}
      data-slide-panel="docked"
      onFocus={() => {
        focusInsideRef.current = true;
      }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) focusInsideRef.current = false;
      }}
      onKeyDown={(event) => {
        // 패널 안의 메뉴·확인·편집기 팝업이 먼저 Esc를 처리하면(preventDefault) 패널은 그대로 둔다.
        if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
        event.preventDefault();
        if (dismissible) onOpenChange(false);
      }}
      // 캔버스 Calendar 보드: 캘린더(flex 999 1 560px) 옆 flex 1 1 440px·최대 520px, 왼쪽 1px 선, 화면 높이에 붙는다.
      className="sticky top-0 flex h-app min-w-0 flex-[1_1_440px] flex-col self-start border-l border-border bg-background shadow-[-12px_0_32px_rgb(24_24_27/0.06)] focus:outline-none md:max-w-[520px]"
    >
      <PanelHeader
        headerStart={headerStart}
        title={headerStart !== undefined ? null : (
          <h2 className="min-w-0 truncate text-ui font-semibold text-foreground">{label}</h2>
        )}
        onStartSlot={setStartSlot}
        onEndSlot={setEndSlot}
        closeButton={(
          <button
            type="button"
            className={CLOSE_BUTTON}
            aria-label="닫기"
            disabled={!dismissible}
            onClick={() => {
              if (dismissible) onOpenChange(false);
            }}
          >
            <X className="size-4" strokeWidth={1.6} aria-hidden="true" />
          </button>
        )}
      />

      <SlidePanelHeaderSlotContext.Provider value={{ start: startSlot, end: endSlot }}>
        <div className={BODY}>{children}</div>
      </SlidePanelHeaderSlotContext.Provider>
    </aside>,
    host,
  );
}
