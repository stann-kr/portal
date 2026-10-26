/**
 * @file src/components/calendar/CalendarQuickCreate.tsx
 * @description 캘린더 칸을 누르거나 끌어 고른 자리에서 바로 노트·일정·레슨을 만드는 작은 창.
 */
"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, FileText, GraduationCap, X } from "lucide-react";
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
  return { x: rect.left + Math.min(rect.width, 320) / 2, y: rect.bottom };
}

type Props = {
  selection: CalendarQuickCreateSelection;
  anchor: { x: number; y: number } | null;
  options: CalendarQuickCreateOptions;
  onCreated: (item: UnifiedItem) => void;
  onClose: () => void;
};

const KIND_META: Record<CalendarQuickCreateKind, { label: string; icon: typeof FileText; submit: string }> = {
  note: { label: "노트", icon: FileText, submit: "노트 쓰기" },
  event: { label: "일정", icon: CalendarClock, submit: "일정 만들기" },
  lesson: { label: "레슨", icon: GraduationCap, submit: "레슨 예약" },
};

const PANEL_WIDTH = 320;
const VIEWPORT_GUTTER = 12;

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

  // 고른 칸 옆에 띄우되 화면 밖으로 나가지 않게 한다. 좁은 화면은 아래쪽 시트로 둔다.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !anchor || window.matchMedia("(max-width: 640px)").matches) {
      setPosition(null);
      return;
    }
    const height = panel.offsetHeight;
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
      if (title.trim()) {
        titleRef.current?.focus({ preventScroll: true });
        return;
      }
      onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [onClose, pending, title]);

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

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="calendar-quick-create fixed inset-x-0 bottom-0 z-[var(--z-overlay)] rounded-t-xl border border-border bg-surface-elevated p-3 shadow-overlay sm:inset-x-auto sm:bottom-auto sm:w-80 sm:rounded-lg"
      style={position ? { left: position.left, top: position.top } : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !pending) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-3"
        aria-describedby={error ? errorId : undefined}
      >
        <div className="flex items-start justify-between gap-2">
          <p id={titleId} className="text-xs font-medium text-muted-foreground">
            {formatKstDateLabel(defaults.dateKey)}
            {defaults.spanLabel ? <span> · {defaults.spanLabel}</span> : null}
          </p>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="빠른 만들기 닫기"
            className="-m-1 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {kinds.length > 1 ? (
          <div role="radiogroup" aria-label="만들 항목" className="flex gap-1 rounded-md bg-muted p-0.5">
            {kinds.map((candidate) => {
              const CandidateIcon = KIND_META[candidate].icon;
              const checked = candidate === kind;
              return (
                <button
                  key={candidate}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => setKind(candidate)}
                  className={`inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded text-xs font-medium transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    checked ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <CandidateIcon className="size-3.5" aria-hidden="true" />
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
            className="h-9 w-full rounded-md border-0 bg-transparent px-1 text-base font-semibold placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        ) : (
          <p className="px-1 text-base font-semibold">레슨</p>
        )}

        {kind !== "note" ? (
          <div className="grid gap-2 text-xs">
            <label className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">시작</span>
              <input
                type="datetime-local"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                required
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              />
            </label>
            {kind === "event" ? (
              <label className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">종료</span>
                <input
                  type="datetime-local"
                  value={end}
                  min={start}
                  onChange={(event) => setEnd(event.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                />
              </label>
            ) : null}
          </div>
        ) : (
          <p className="px-1 text-xs text-muted-foreground">이 날짜의 노트 페이지를 열어 바로 이어서 씁니다.</p>
        )}

        {error ? (
          <p id={errorId} role="alert" className="text-xs text-destructive">{error}</p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>취소</Button>
          <Button type="submit" size="sm" disabled={pending} aria-busy={pending}>
            <Meta.icon className="size-3.5" aria-hidden="true" />
            {pending ? "저장 중..." : Meta.submit}
          </Button>
        </div>
      </form>
    </div>
  );
}
