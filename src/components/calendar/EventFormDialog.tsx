/**
 * @file src/components/calendar/EventFormDialog.tsx
 * @description 캘린더 이벤트 생성/수정 다이얼로그.
 * 날짜 클릭 또는 이벤트 클릭 시 열림.
 */
"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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

function initialFields(defaultStart?: string) {
  const parsed = defaultStart ? parseKstDateTimeInput(defaultStart) ?? new Date(defaultStart) : null;
  const start = parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
  return {
    eventType: "NOTE" as CalendarEventType,
    title: "",
    startTime: start ? toKstDateTimeInputValue(start) : "",
    endTime: start ? toKstDateTimeInputValue(new Date(start.getTime() + 60 * 60 * 1000)) : "",
    description: "",
  };
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
    async (previous, data) => {
      try {
        return await createCalendarEvent(previous, data);
      } catch {
        return { error: "저장 결과를 확인하지 못했습니다. 일정을 확인한 뒤 다시 시도해 주세요." };
      }
    },
    {},
  );
  const [fields, setFields] = useState(() => initialFields(defaultStart));
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const handledEventIdRef = useRef<string | null>(null);
  const error = hasSubmitted && !isPending ? state.error : undefined;

  useEffect(() => {
    if (!open) return;
    setFields(initialFields(defaultStart));
    setHasSubmitted(false);
  }, [open, defaultStart]);

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

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isPending) onOpenChange(nextOpen); }}>
      <DialogContent dismissible={!isPending}>
        <DialogHeader>
          <DialogTitle>새 일정 추가</DialogTitle>
          <DialogDescription>날짜와 시간을 확인하고 일정을 저장하세요.</DialogDescription>
        </DialogHeader>

        <form action={action} onSubmit={() => setHasSubmitted(true)} className="space-y-4" aria-busy={isPending}>
          {error && (
            <p id="event-form-error" role="alert" className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          {/* 이벤트 유형 */}
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">유형</legend>
            <div className="flex flex-wrap gap-2">
              {EVENT_TYPES.map(({ value, label, color }) => (
                <label key={value} className="cursor-pointer">
                  <input
                    type="radio"
                    name="eventType"
                    value={value}
                    checked={fields.eventType === value}
                    onChange={() => setFields((current) => ({ ...current, eventType: value }))}
                    className="sr-only peer"
                    disabled={isPending}
                  />
                  <span className="flex min-h-9 items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground peer-checked:border-foreground peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring transition-colors">
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
              value={fields.title}
              onChange={(event) => setFields((current) => ({ ...current, title: event.target.value }))}
              placeholder="일정 제목"
              required
              disabled={isPending}
              aria-describedby={error ? "event-form-error" : undefined}
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
              value={fields.startTime}
              onChange={(event) => setFields((current) => ({ ...current, startTime: event.target.value }))}
              required
              disabled={isPending}
              aria-describedby={error ? "event-form-error" : undefined}
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
              value={fields.endTime}
              onChange={(event) => setFields((current) => ({ ...current, endTime: event.target.value }))}
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
              value={fields.description}
              onChange={(event) => setFields((current) => ({ ...current, description: event.target.value }))}
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
