/**
 * @file src/components/calendar/EventFormDialog.tsx
 * @description 캘린더 이벤트 생성/수정 다이얼로그.
 * 날짜 클릭 또는 이벤트 클릭 시 열림.
 */
"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createCalendarEvent, type CreateEventState } from "@/lib/actions/calendarEvents";
import type { CalendarEventType } from "@/db/schema";
import { parseKstDateTimeInput, toKstDateTimeInputValue } from "@/lib/date-input";
import { createCalendarEventUnifiedItem } from "@/lib/unified-item-normalization";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

const EVENT_TYPES: { value: CalendarEventType; label: string; color: string }[] = [
  { value: "LESSON", label: "수업", color: "bg-event-lesson" },
  { value: "PRACTICE", label: "연습", color: "bg-event-practice" },
  { value: "GIG", label: "공연", color: "bg-event-gig" },
  { value: "NOTE", label: "메모", color: "bg-event-note" },
];

interface EventFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 날짜 클릭 시 기본값으로 채울 시작 시각 (ISO string) */
  defaultStart?: string;
  studentId?: string;
  spaceLabel?: string;
  /** 생성 완료 후 콜백 */
  onSuccess?: (item: UnifiedItem) => void;
}

export function EventFormDialog({
  open,
  onOpenChange,
  defaultStart,
  studentId,
  spaceLabel,
  onSuccess,
}: EventFormDialogProps) {
  const [state, action, isPending] = useActionState<CreateEventState, FormData>(
    createCalendarEvent,
    {},
  );
  const handledEventIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (state.event && handledEventIdRef.current !== state.event.id) {
      handledEventIdRef.current = state.event.id;
      const item = createCalendarEventUnifiedItem({
        ...state.event,
        startTime: new Date(state.event.startTime),
        endTime: state.event.endTime ? new Date(state.event.endTime) : null,
      }, {
        id: studentId ?? "current-student",
        email: spaceLabel || "내 스페이스",
        displayName: spaceLabel || "내 스페이스",
      });
      onOpenChange(false);
      onSuccess?.(item);
    }
  }, [onOpenChange, onSuccess, spaceLabel, state.event, studentId]);

  const parsedDefaultStart = defaultStart
    ? parseKstDateTimeInput(defaultStart) ?? new Date(defaultStart)
    : null;
  const hasDefaultStart = parsedDefaultStart && Number.isFinite(parsedDefaultStart.getTime());
  const defaultStartLocal = hasDefaultStart
    ? toKstDateTimeInputValue(parsedDefaultStart)
    : "";

  const defaultEndLocal = hasDefaultStart
    ? toKstDateTimeInputValue(new Date(parsedDefaultStart.getTime() + 60 * 60 * 1000))
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>새 일정 추가</DialogTitle>
        </DialogHeader>

        <form action={action} className="space-y-4" aria-busy={isPending}>
          {state.error && (
            <p id="event-form-error" role="alert" className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
              {state.error}
            </p>
          )}

          {/* 이벤트 유형 */}
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">유형</legend>
            <div className="flex gap-2">
              {EVENT_TYPES.map(({ value, label, color }) => (
                <label key={value} className="cursor-pointer">
                  <input
                    type="radio"
                    name="eventType"
                    value={value}
                    defaultChecked={value === "NOTE"}
                    className="sr-only peer"
                    disabled={isPending}
                  />
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground peer-checked:border-foreground peer-checked:text-foreground transition-colors">
                    <span className={`w-2 h-2 rounded-full ${color}`} />
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* 제목 */}
          <div className="space-y-1.5">
            <label htmlFor="event-title" className="text-sm font-medium">
              제목 <span className="text-destructive">*</span>
            </label>
            <Input
              id="event-title"
              name="title"
              placeholder="일정 제목"
              required
              disabled={isPending}
              aria-describedby={state.error ? "event-form-error" : undefined}
            />
          </div>

          {/* 시작 시각 */}
          <div className="space-y-1.5">
            <label htmlFor="event-start" className="text-sm font-medium">
              시작 <span className="text-destructive">*</span>
            </label>
            <Input
              id="event-start"
              name="startTime"
              type="datetime-local"
              defaultValue={defaultStartLocal}
              required
              disabled={isPending}
              aria-describedby={state.error ? "event-form-error" : undefined}
            />
          </div>

          {/* 종료 시각 */}
          <div className="space-y-1.5">
            <label htmlFor="event-end" className="text-sm font-medium">
              종료 <span className="text-muted-foreground text-xs">(선택)</span>
            </label>
            <Input
              id="event-end"
              name="endTime"
              type="datetime-local"
              defaultValue={defaultEndLocal}
              disabled={isPending}
            />
          </div>

          {/* 메모 */}
          <div className="space-y-1.5">
            <label htmlFor="event-desc" className="text-sm font-medium">
              메모 <span className="text-muted-foreground text-xs">(선택)</span>
            </label>
            <textarea
              id="event-desc"
              name="description"
              rows={2}
              placeholder="추가 메모..."
              disabled={isPending}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            />
          </div>

          {/* 버튼 */}
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={isPending} className="flex-1">
              {isPending ? "저장 중..." : "저장"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              취소
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
