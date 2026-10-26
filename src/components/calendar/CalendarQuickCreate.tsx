/**
 * @file src/components/calendar/CalendarQuickCreate.tsx
 * @description 캘린더 칸을 누르거나 끌어 고른 자리에서 바로 노트·일정·레슨을 만드는 창.
 * 넓은 화면은 고른 칸 옆의 300px 떠 있는 창(캔버스 AdminSchedule), 좁은 화면은 아래 시트(MobileQuickCreate).
 */
"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createCalendarEvent } from "@/lib/actions/calendarEvents";
import { createLesson } from "@/lib/actions/lessons";
import { CALENDAR_EVENT_TITLE_MAX_LENGTH } from "@/lib/calendar-event-contract";
import { formatKstDateLabel, parseKstDateTimeInput } from "@/lib/date-input";
import { PRIVATE_NOTE_MAX_TITLE_LENGTH } from "@/lib/private-note-continuity";
import { createCalendarEventUnifiedItem, createLessonUnifiedItem } from "@/lib/unified-item-normalization";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import {
  getQuickCreateDefaults,
  type CalendarQuickCreateKind,
  type CalendarQuickCreateSelection,
} from "@/lib/calendar-quick-create";
import { cn } from "@/lib/utils";
import { formatDayLong } from "./calendar-dates";

export type CalendarQuickCreateOptions = {
  /** 노트 composer 주소. 없으면 노트를 만들 수 없다. */
  buildNoteHref?: (dateKey: string, title: string) => string;
  canCreateEvent: boolean;
  canCreateLesson: boolean;
  studentId: string;
  spaceLabel: string;
};

/** 만들 수 있는 항목이 하나라도 있을 때만 빠른 만들기를 연다. */
export function canUseQuickCreate(options: CalendarQuickCreateOptions | undefined): options is CalendarQuickCreateOptions {
  return Boolean(options && (options.buildNoteHref || options.canCreateEvent || options.canCreateLesson));
}

/** 버튼에서 연 창은 버튼 바로 아래에 붙인다. */
export function getQuickCreateAnchor(element: HTMLElement): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + Math.min(rect.width, 300) / 2, y: rect.bottom };
}

type Props = {
  selection: CalendarQuickCreateSelection;
  anchor: { x: number; y: number } | null;
  options: CalendarQuickCreateOptions;
  onCreated: (item: UnifiedItem) => void;
  onClose: () => void;
};

const KIND_META: Record<CalendarQuickCreateKind, { label: string; submit: string }> = {
  note: { label: "노트", submit: "노트 쓰기" },
  event: { label: "일정", submit: "일정 만들기" },
  lesson: { label: "레슨", submit: "레슨 예약" },
};

const PANEL_WIDTH = 300;
const VIEWPORT_GUTTER = 12;
/** md(48rem)보다 좁으면 아래 시트. 경계값이 md 클래스와 겹치지 않게 같은 기준을 쓴다. */
const SHEET_QUERY = "(max-width: 47.99rem)";

export function CalendarQuickCreate({ selection, anchor, options, onCreated, onClose }: Props) {
  const router = useRouter();
  const titleId = useId();
  const errorId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const kinds = (["note", "event", "lesson"] as const).filter((kind) =>
    kind === "note" ? Boolean(options.buildNoteHref) : kind === "event" ? options.canCreateEvent : options.canCreateLesson,
  );
  const defaults = getQuickCreateDefaults(selection, kinds);
  const [kind, setKind] = useState<CalendarQuickCreateKind>(defaults.kind);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [kindChosen, setKindChosen] = useState(false);

  // 창이 열린 채 다른 칸을 고르면 시각을 새 선택으로 옮기고, 입력한 제목과 직접 고른 유형은 그대로 둔다.
  const selectionKey = `${selection.startStr}|${selection.endStr}|${selection.allDay}`;
  const [appliedSelectionKey, setAppliedSelectionKey] = useState(selectionKey);
  if (appliedSelectionKey !== selectionKey) {
    setAppliedSelectionKey(selectionKey);
    setStart(defaults.start);
    setEnd(defaults.end);
    setError(null);
    if (!kindChosen || !kinds.includes(kind)) setKind(defaults.kind);
  }

  // 고른 칸 옆에 띄우되 화면 밖으로 나가지 않게 한다. 좁은 화면은 아래쪽 시트로 둔다.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || window.matchMedia(SHEET_QUERY).matches) {
      setPosition(null);
      return;
    }
    const height = panel.offsetHeight;
    if (!anchor) {
      // 터치 선택이나 위쪽 막대의 만들기처럼 기준점이 없으면 화면 가운데 위쪽에 둔다.
      setPosition({
        left: Math.max((window.innerWidth - PANEL_WIDTH) / 2, VIEWPORT_GUTTER),
        top: Math.max((window.innerHeight - height) / 3, VIEWPORT_GUTTER),
      });
      return;
    }
    const left = Math.min(
      Math.max(anchor.x - PANEL_WIDTH / 2, VIEWPORT_GUTTER),
      window.innerWidth - PANEL_WIDTH - VIEWPORT_GUTTER,
    );
    const below = anchor.y + 8;
    const top = below + height + VIEWPORT_GUTTER > window.innerHeight
      ? Math.max(anchor.y - height - 8, VIEWPORT_GUTTER)
      : below;
    setPosition({ left, top });
  }, [anchor, kind]);

  useLayoutEffect(() => {
    (titleRef.current ?? panelRef.current)?.focus({ preventScroll: true });
  }, []);

  // 바깥을 누르면 닫되, 입력한 제목이 있으면 실수로 잃지 않게 창을 유지한다.
  useLayoutEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (pending || panelRef.current?.contains(event.target as Node)) return;
      if (kind !== "lesson" && title.trim()) {
        titleRef.current?.focus({ preventScroll: true });
        return;
      }
      onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [kind, onClose, pending, title]);

  async function submit() {
    if (pending) return;
    setError(null);
    const trimmed = title.trim();
    if (kind === "note") {
      if (!options.buildNoteHref) return;
      router.push(options.buildNoteHref(defaults.dateKey, trimmed));
      onClose();
      return;
    }
    const startDate = parseKstDateTimeInput(start);
    if (!startDate) {
      setError("시작 시간을 확인해 주세요.");
      return;
    }
    setPending(true);
    try {
      if (kind === "event") {
        if (!trimmed) {
          setError("일정 제목을 입력해 주세요.");
          titleRef.current?.focus();
          return;
        }
        const formData = new FormData();
        formData.set("title", trimmed);
        formData.set("eventType", "PRACTICE");
        formData.set("startTime", start);
        formData.set("endTime", end);
        formData.set("description", "");
        const result = await createCalendarEvent({}, formData);
        if (!result.event) {
          setError(result.error ?? "일정을 만들지 못했습니다.");
          return;
        }
        onCreated(createCalendarEventUnifiedItem({
          ...result.event,
          startTime: new Date(result.event.startTime),
          endTime: result.event.endTime ? new Date(result.event.endTime) : null,
        }, { id: options.studentId, email: options.spaceLabel, displayName: options.spaceLabel }));
      } else {
        const formData = new FormData();
        formData.set("scheduledAt", start);
        const result = await createLesson(options.studentId, {}, formData);
        if (!result.lesson) {
          setError(result.error ?? "레슨을 예약하지 못했습니다.");
          return;
        }
        onCreated(createLessonUnifiedItem(
          { id: result.lesson.id, scheduledAt: new Date(result.lesson.scheduledAt) },
          { id: options.studentId, email: options.spaceLabel, displayName: options.spaceLabel },
        ));
      }
      onClose();
    } catch {
      setError("저장 결과를 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  const Meta = KIND_META[kind];
  const showTitle = kind !== "lesson";
  const maxTitle = kind === "note" ? PRIVATE_NOTE_MAX_TITLE_LENGTH : CALENDAR_EVENT_TITLE_MAX_LENGTH;
  const caption = [formatKstDateLabel(defaults.dateKey), defaults.spanLabel, options.canCreateLesson ? options.spaceLabel : null]
    .filter(Boolean)
    .join(" · ");
  const timeInput = "h-11 w-full rounded-touch border border-input bg-background px-3 font-mono text-base text-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring md:h-[30px] md:w-[150px] md:rounded-md md:px-2 md:text-xs";

  return (
    <>
      {/* 좁은 화면 시트 뒤 화면을 32% 어둡게. 누르면 바깥 누름과 같이 처리된다. */}
      <div aria-hidden="true" data-state="open" className="portal-backdrop fixed inset-0 z-[var(--z-overlay)] bg-scrim md:hidden" />
      <div
        ref={panelRef}
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-state="open"
        className="calendar-quick-create portal-dialog fixed inset-x-0 bottom-0 z-[var(--z-overlay)] flex flex-col rounded-t-xl bg-background px-5 pb-[calc(2.125rem+env(safe-area-inset-bottom))] pt-2 shadow-sheet focus-visible:outline-none md:inset-x-auto md:bottom-auto md:w-[300px] md:rounded-lg md:border md:border-border md:p-3.5 md:shadow-overlay"
        style={position ? { left: position.left, top: position.top } : undefined}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !pending) {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <span aria-hidden="true" className="mx-auto mb-4 block h-1 w-9 rounded-full bg-border md:hidden" />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-4 md:gap-3"
          aria-describedby={error ? errorId : undefined}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id={titleId} className="text-md font-semibold text-foreground md:text-xs md:font-normal md:text-muted-foreground">
              <span className="md:hidden">{formatDayLong(defaults.dateKey)}에 만들기</span>
              <span className="hidden md:inline">{caption}</span>
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              aria-label="빠른 만들기 닫기"
              className="-mr-3 flex size-11 shrink-0 items-center justify-center rounded-touch text-secondary-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
            >
              <X className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />
            </button>
          </div>

          {kinds.length > 1 ? (
            <div
              role="radiogroup"
              aria-label="만들 항목"
              className="flex h-12 gap-0.5 rounded-lg bg-muted p-0.5 md:h-8 md:rounded-md"
              onKeyDown={(event) => {
                // 라디오 묶음 규칙: 화살표로 고르고, 탭 정지는 선택된 항목 하나만 둔다.
                const step = event.key === "ArrowRight" || event.key === "ArrowDown"
                  ? 1
                  : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
                if (!step) return;
                event.preventDefault();
                const next = kinds[(kinds.indexOf(kind) + step + kinds.length) % kinds.length];
                setKind(next);
                setKindChosen(true);
                event.currentTarget.querySelector<HTMLElement>(`[data-kind="${next}"]`)?.focus();
              }}
            >
              {kinds.map((candidate) => {
                const checked = candidate === kind;
                return (
                  <button
                    key={candidate}
                    type="button"
                    role="radio"
                    data-kind={candidate}
                    aria-checked={checked}
                    tabIndex={checked ? 0 : -1}
                    onClick={(event) => {
                      setKind(candidate);
                      setKindChosen(true);
                      // 마우스로 고르면 바로 제목을 이어 쓰게 한다. 키보드 선택은 포커스를 그대로 둔다.
                      if (event.detail > 0 && candidate !== "lesson") {
                        requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
                      }
                    }}
                    className={cn(
                      "flex-1 rounded-touch text-md transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:rounded-sm md:text-xs",
                      checked ? "bg-background font-medium text-foreground shadow-segment" : "text-secondary-foreground hover:text-foreground",
                    )}
                  >
                    {KIND_META[candidate].label}
                  </button>
                );
              })}
            </div>
          ) : null}

          {showTitle ? (
            <input
              ref={titleRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={maxTitle}
              placeholder={kind === "note" ? "새 노트 제목" : "일정 제목"}
              aria-label={kind === "note" ? "노트 제목" : "일정 제목"}
              className="h-[52px] w-full rounded-none border-0 border-b-[1.5px] border-foreground bg-transparent px-0.5 text-xl font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none md:h-9 md:border-b md:border-border md:text-md md:focus:border-foreground"
            />
          ) : null}

          {kind !== "note" ? (
            <div className="flex flex-col gap-3 md:gap-2">
              <label className="flex flex-col gap-1.5 text-ui text-secondary-foreground md:flex-row md:items-center md:justify-between md:text-xs md:text-muted-foreground">
                시작
                <input
                  type="datetime-local"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                  required
                  className={timeInput}
                />
              </label>
              {kind === "event" ? (
                <label className="flex flex-col gap-1.5 text-ui text-secondary-foreground md:flex-row md:items-center md:justify-between md:text-xs md:text-muted-foreground">
                  종료
                  <input
                    type="datetime-local"
                    value={end}
                    min={start}
                    onChange={(event) => setEnd(event.target.value)}
                    className={timeInput}
                  />
                </label>
              ) : null}
            </div>
          ) : (
            <p className="text-ui text-muted-foreground md:text-xs">이 날짜의 노트를 만들고 바로 이어서 씁니다.</p>
          )}

          {error ? (
            <p id={errorId} role="alert" className="text-ui text-destructive md:text-xs">{error}</p>
          ) : null}

          <div className="flex items-center justify-end gap-1.5">
            <Button type="button" variant="ghost" className="hidden h-[30px] px-2.5 text-xs md:inline-flex" onClick={onClose} disabled={pending}>
              취소
            </Button>
            <Button type="submit" size="touch" className="w-full md:h-[30px] md:w-auto md:rounded-md md:px-3 md:text-xs" disabled={pending} aria-busy={pending}>
              {pending ? "저장 중..." : Meta.submit}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
