/**
 * @file src/components/calendar/EventFormDialog.tsx
 * @description 캘린더 이벤트 생성/수정 다이얼로그.
 * 날짜 클릭 또는 이벤트 클릭 시 열림.
 */
"use client";

import { useActionState, useEffect } from "react";
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
  /** 생성 완료 후 콜백 */
  onSuccess?: () => void;
}

export function EventFormDialog({
  open,
  onOpenChange,
  defaultStart,
  onSuccess,
}: EventFormDialogProps) {
  const [state, action, isPending] = useActionState<CreateEventState, FormData>(
    createCalendarEvent,
    {},
  );

  useEffect(() => {
    if (state.id) {
      onOpenChange(false);
      onSuccess?.();
    }
  }, [state.id, onOpenChange, onSuccess]);

  // defaultStart를 datetime-local 포맷으로 변환
  const defaultStartLocal = defaultStart
    ? new Date(defaultStart).toISOString().slice(0, 16)
    : "";

  const defaultEndLocal = defaultStart
    ? new Date(new Date(defaultStart).getTime() + 60 * 60 * 1000)
        .toISOString()
        .slice(0, 16)
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>새 일정 추가</DialogTitle>
        </DialogHeader>

        <form action={action} className="space-y-4">
          {state.error && (
            <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
              {state.error}
            </p>
          )}

          {/* 이벤트 유형 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">유형</label>
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
          </div>

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
