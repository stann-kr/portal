"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOverlayFocus } from "@/components/ui/use-overlay-focus";
import {
  DOUBLE_TAP_SCALE,
  IDENTITY,
  MAX_SCALE,
  clamp,
  clampTransform,
  naturalScale,
  wrapIndex,
  zoomAround,
  type ViewerTransform,
} from "./image-viewer-geometry";

export type ViewerImage = { src: string; alt?: string | null };

export type ImageViewerProps = {
  images: ViewerImage[];
  /** 열려 있으면 보여 줄 이미지 위치, 닫혀 있으면 null. */
  index: number | null;
  onIndexChange: (index: number | null) => void;
  /** 닫힌 뒤 초점을 돌려줄 요소. 없으면 열기 직전 초점 요소로 돌아간다. */
  returnFocus?: HTMLElement | null;
};

const TAP_SLOP = 8;
const DOUBLE_TAP_MS = 300;
const SWIPE_DISTANCE = 60;
const DISMISS_DISTANCE = 100;

type Gesture =
  | { kind: "idle" }
  | { kind: "pending"; startX: number; startY: number; at: number; pointerType: string }
  | { kind: "pan"; startX: number; startY: number; origin: ViewerTransform; moved: boolean }
  | { kind: "swipe"; startX: number }
  | { kind: "dismiss"; startY: number }
  | { kind: "pinch"; startDistance: number; origin: ViewerTransform; mid: { x: number; y: number } };

/**
 * 읽기 화면 이미지의 전체화면 뷰어(ImageViewer 보드).
 * 화면에 맞춰 보이고, 누르면 원래 크기(넘치면 끌어서 이동). 휴대폰은 두 손가락 확대·두 번 눌러 확대·옆으로 밀어 넘기기·아래로 끌어 닫기.
 */
export function ImageViewer({ images, index, onIndexChange, returnFocus }: ImageViewerProps) {
  const open = index !== null && images.length > 0;
  const current = open ? wrapIndex(index, images.length) : 0;
  const image = images[current];
  const total = images.length;
  const { captureFocus, restoreFocus } = useOverlayFocus();
  const closeRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => onIndexChange(null), [onIndexChange]);
  const go = useCallback((step: number) => {
    if (total > 1 && index !== null) onIndexChange(wrapIndex(index + step, total));
  }, [index, onIndexChange, total]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
  };

  const label = image?.alt?.trim() || "이미지";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="image-viewer-backdrop portal-fade fixed inset-0 z-50" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          onOpenAutoFocus={(event) => {
            captureFocus();
            event.preventDefault();
            closeRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (returnFocus?.isConnected) {
              event.preventDefault();
              returnFocus.focus({ preventScroll: true });
              return;
            }
            restoreFocus(event);
          }}
          className="image-viewer portal-fade fixed inset-0 z-50 flex flex-col text-white outline-none"
        >
          <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 pl-4 pr-1 md:h-14 md:pl-5 md:pr-2">
            <DialogPrimitive.Title className="min-w-0 truncate text-[13px] font-normal text-[var(--image-viewer-caption)]">
              {/* 휴대폰은 번호만 보이고 이미지 이름은 화면 읽기 프로그램에만 준다. */}
              <span className="sr-only md:not-sr-only">{label}{total > 1 ? " · " : ""}</span>
              {total > 1 ? `${current + 1} / ${total}` : null}
            </DialogPrimitive.Title>
            <span className="flex shrink-0 gap-1">
              {image ? (
                <a
                  href={image.src}
                  target="_blank"
                  rel="noreferrer"
                  className="hidden h-10 items-center rounded-touch px-3 text-[13px] text-white no-underline transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none md:inline-flex"
                >
                  원본 열기
                </a>
              ) : null}
              <DialogPrimitive.Close
                ref={closeRef}
                type="button"
                aria-label="닫기"
                className="flex size-11 items-center justify-center rounded-touch text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none"
              >
                <X className="size-5" strokeWidth={1.8} aria-hidden="true" />
              </DialogPrimitive.Close>
            </span>
          </div>
          {image ? (
            <ImageStage
              key={`${current}:${image.src}`}
              image={image}
              label={label}
              hasSiblings={total > 1}
              onPrev={() => go(-1)}
              onNext={() => go(1)}
              onClose={close}
            />
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ImageStage({
  image,
  label,
  hasSiblings,
  onPrev,
  onNext,
  onClose,
}: {
  image: ViewerImage;
  label: string;
  hasSiblings: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [transform, setTransform] = useState<ViewerTransform>(IDENTITY);
  // 옆으로 밀기·아래로 끌기 중의 임시 이동. 놓으면 0으로 돌아가거나 넘기기·닫기로 끝난다.
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [zoomable, setZoomable] = useState(false);
  const [active, setActive] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture>({ kind: "idle" });
  const lastTap = useRef(0);

  const measure = useCallback(() => {
    const stage = stageRef.current;
    const img = imageRef.current;
    if (!stage || !img) return null;
    return {
      fit: { width: img.offsetWidth, height: img.offsetHeight },
      stage: { width: stage.clientWidth, height: stage.clientHeight },
      natural: { width: img.naturalWidth, height: img.naturalHeight },
      rect: stage.getBoundingClientRect(),
    };
  }, []);

  const updateZoomable = useCallback(() => {
    const size = measure();
    setZoomable(Boolean(size && naturalScale(size.natural, size.fit) > 1.01));
  }, [measure]);

  useEffect(() => {
    const img = imageRef.current;
    if (img?.complete) updateZoomable();
    window.addEventListener("resize", updateZoomable);
    return () => window.removeEventListener("resize", updateZoomable);
  }, [updateZoomable]);

  // 화면 가운데를 원점으로 둔 포인터 좌표.
  const toCenter = (clientX: number, clientY: number) => {
    const size = measure();
    if (!size) return { x: 0, y: 0 };
    return { x: clientX - size.rect.left - size.rect.width / 2, y: clientY - size.rect.top - size.rect.height / 2 };
  };

  const applyTransform = (next: ViewerTransform) => {
    const size = measure();
    setTransform(size ? clampTransform(next, size.fit, size.stage) : next);
  };

  const toggleZoom = (clientX: number, clientY: number, targetScale: number) => {
    if (transform.scale > 1.01) { setTransform(IDENTITY); return; }
    if (targetScale <= 1.01) return;
    applyTransform(zoomAround(IDENTITY, targetScale, toCenter(clientX, clientY)));
  };

  const pinchState = () => {
    const [a, b] = [...pointers.current.values()];
    return { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: toCenter((a.x + b.x) / 2, (a.y + b.y) / 2) };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button, a")) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setActive(true);
    if (pointers.current.size === 2) {
      const { distance, mid } = pinchState();
      setDrag({ x: 0, y: 0 });
      gesture.current = { kind: "pinch", startDistance: distance, origin: transform, mid };
      return;
    }
    if (pointers.current.size > 2) return;
    gesture.current = transform.scale > 1.01
      ? { kind: "pan", startX: event.clientX, startY: event.clientY, origin: transform, moved: false }
      : { kind: "pending", startX: event.clientX, startY: event.clientY, at: Date.now(), pointerType: event.pointerType };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const state = gesture.current;
    if (state.kind === "pinch" && pointers.current.size >= 2) {
      const { distance, mid } = pinchState();
      const scale = clamp(state.origin.scale * (distance / state.startDistance), 1, MAX_SCALE);
      const zoomed = zoomAround(state.origin, scale, state.mid);
      applyTransform({ scale, x: zoomed.x + mid.x - state.mid.x, y: zoomed.y + mid.y - state.mid.y });
    } else if (state.kind === "pan") {
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      if (Math.hypot(dx, dy) > TAP_SLOP) state.moved = true;
      applyTransform({ ...state.origin, x: state.origin.x + dx, y: state.origin.y + dy });
    } else if (state.kind === "pending") {
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      // 휴대폰만 밀어 넘기기·끌어 닫기. 마우스 끌기는 아무 것도 하지 않는다.
      if (state.pointerType === "mouse" || Math.hypot(dx, dy) <= TAP_SLOP) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        if (hasSiblings) gesture.current = { kind: "swipe", startX: state.startX };
      } else if (dy > 0) {
        gesture.current = { kind: "dismiss", startY: state.startY };
      }
    } else if (state.kind === "swipe") {
      setDrag({ x: event.clientX - state.startX, y: 0 });
    } else if (state.kind === "dismiss") {
      setDrag({ x: 0, y: Math.max(0, event.clientY - state.startY) });
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(event.pointerId)) return;
    if (pointers.current.size === 0) setActive(false);
    const state = gesture.current;
    if (state.kind === "pinch") {
      // 한 손가락이 남으면 이어서 이동한다.
      const [rest] = [...pointers.current.entries()];
      gesture.current = rest
        ? { kind: "pan", startX: rest[1].x, startY: rest[1].y, origin: transform, moved: true }
        : { kind: "idle" };
      return;
    }
    if (pointers.current.size > 0) return;
    gesture.current = { kind: "idle" };

    if (state.kind === "swipe") {
      const dx = event.clientX - state.startX;
      setDrag({ x: 0, y: 0 });
      if (dx <= -SWIPE_DISTANCE) onNext();
      else if (dx >= SWIPE_DISTANCE) onPrev();
      return;
    }
    if (state.kind === "dismiss") {
      if (event.clientY - state.startY >= DISMISS_DISTANCE) onClose();
      else setDrag({ x: 0, y: 0 });
      return;
    }
    if (state.kind === "pan" && !state.moved && event.pointerType === "mouse") {
      toggleZoom(event.clientX, event.clientY, 1);
      return;
    }
    if (state.kind === "pan" && !state.moved && event.pointerType !== "mouse") {
      handleTouchTap(event);
      return;
    }
    if (state.kind !== "pending") return;
    // 넘기기·닫기로 이어지지 않은 끌기는 누르기로 치지 않는다.
    if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) > TAP_SLOP) return;

    const onImage = event.target === imageRef.current;
    if (state.pointerType === "mouse") {
      // 이미지 바깥(어두운 바탕)을 누르면 닫는다.
      if (!onImage) { onClose(); return; }
      const size = measure();
      toggleZoom(event.clientX, event.clientY, size ? naturalScale(size.natural, size.fit) : 1);
      return;
    }
    handleTouchTap(event);
  };

  const handleTouchTap = (event: ReactPointerEvent<HTMLDivElement>) => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      toggleZoom(event.clientX, event.clientY, DOUBLE_TAP_SCALE);
    } else {
      lastTap.current = now;
    }
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      setActive(false);
      gesture.current = { kind: "idle" };
      setDrag({ x: 0, y: 0 });
    }
  };

  const zoomed = transform.scale > 1.01;
  const dragging = drag.x !== 0 || drag.y !== 0;
  const imageStyle: CSSProperties = {
    transform: `translate3d(${transform.x + drag.x}px, ${transform.y + drag.y}px, 0) scale(${transform.scale})`,
    cursor: zoomed ? "grab" : zoomable ? "zoom-in" : "default",
  };
  // 아래로 끌수록 바탕이 옅어져 닫힘을 미리 보여 준다.
  const stageStyle: CSSProperties | undefined = drag.y > 0 ? { opacity: clamp(1 - drag.y / 400, 0.4, 1) } : undefined;

  return (
    <div
      className="relative flex min-h-0 flex-1 items-center justify-between gap-4 pb-[52px] md:px-3 md:pb-8"
      // 이미지 옆 빈 바탕을 누르면 닫는다(Radix 바깥 누르기는 전체화면 내용 위에서 일어나지 않는다).
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      {hasSiblings ? (
        <StageButton label="이전 이미지" onClick={onPrev}>
          <ChevronLeft className="size-5" strokeWidth={1.8} aria-hidden="true" />
        </StageButton>
      ) : null}
      <div
        ref={stageRef}
        data-image-viewer-stage=""
        className={cn("relative flex h-full min-w-0 flex-1 touch-none select-none items-center justify-center overflow-hidden", (dragging || active) && "image-viewer-dragging")}
        style={stageStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- 저장된 본문 이미지(/api/media·data:)를 그대로 보여 준다. */}
        <img
          ref={imageRef}
          src={image.src}
          alt={label}
          draggable={false}
          onLoad={updateZoomable}
          className="image-viewer-image block max-h-full max-w-full rounded-xs object-contain"
          style={imageStyle}
        />
      </div>
      {hasSiblings ? (
        <StageButton label="다음 이미지" onClick={onNext}>
          <ChevronRight className="size-5" strokeWidth={1.8} aria-hidden="true" />
        </StageButton>
      ) : null}
    </div>
  );
}

function StageButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="hidden size-11 shrink-0 items-center justify-center rounded-full bg-white/12 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none md:flex"
    >
      {children}
    </button>
  );
}
