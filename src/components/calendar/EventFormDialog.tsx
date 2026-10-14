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
import { createCalendarEvent, type CreateEventState } from "@/lib/actions/calendarEvents";
import { parseKstDateTimeInput, toKstDateTimeInputValue } from "@/lib/date-input";
import { createCalendarEventUnifiedItem } from "@/lib/unified-item-normalization";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";
import { CalendarEventFields, type CalendarEventFieldValues } from "./CalendarEventFields";

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

function initialFields(defaultStart?: string): CalendarEventFieldValues {
  const parsed = defaultStart ? parseKstDateTimeInput(defaultStart) ?? new Date(defaultStart) : null;
  const start = parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
  return {
    eventType: "NOTE",
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

          <CalendarEventFields
            idPrefix="event"
            values={fields}
            onChange={setFields}
            disabled={isPending}
            errorId={error ? "event-form-error" : undefined}
          />

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
