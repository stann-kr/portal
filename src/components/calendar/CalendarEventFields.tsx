"use client";

import { Input } from "@/components/ui/input";
import type { CalendarEventType } from "@/db/schema";

export type CalendarEventFieldValues = {
  eventType: CalendarEventType;
  title: string;
  startTime: string;
  endTime: string;
  description: string;
};

export const CALENDAR_EVENT_TYPE_OPTIONS: { value: CalendarEventType; label: string; color: string }[] = [
  { value: "LESSON", label: "수업", color: "bg-event-lesson" },
  { value: "PRACTICE", label: "연습", color: "bg-event-practice" },
  { value: "GIG", label: "공연", color: "bg-event-gig" },
  { value: "NOTE", label: "메모", color: "bg-event-note" },
];

/** 일정 생성 dialog와 상세 패널 수정 form이 같은 입력 계약을 사용한다. */
export function CalendarEventFields({
  idPrefix,
  values,
  onChange,
  disabled,
  errorId,
}: {
  idPrefix: string;
  values: CalendarEventFieldValues;
  onChange: (next: CalendarEventFieldValues) => void;
  disabled: boolean;
  /** 오류 문구가 보일 때 제목·시작 입력이 참조할 id. */
  errorId?: string;
}) {
  const update = <K extends keyof CalendarEventFieldValues>(key: K, value: CalendarEventFieldValues[K]) =>
    onChange({ ...values, [key]: value });

  return (
    <>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">유형</legend>
        <div className="flex flex-wrap gap-2">
          {CALENDAR_EVENT_TYPE_OPTIONS.map(({ value, label, color }) => (
            <label key={value} className="cursor-pointer">
              <input
                type="radio"
                name="eventType"
                value={value}
                checked={values.eventType === value}
                onChange={() => update("eventType", value)}
                className="sr-only peer"
                disabled={disabled}
              />
              <span className="flex min-h-9 items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground peer-checked:border-foreground peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring transition-colors">
                <span className={`w-2 h-2 rounded-full ${color}`} aria-hidden="true" />
                {label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-title`} className="text-sm font-medium">
          제목 <span className="text-destructive" aria-hidden="true">*</span>
        </label>
        <Input
          id={`${idPrefix}-title`}
          name="title"
          value={values.title}
          onChange={(event) => update("title", event.target.value)}
          placeholder="일정 제목"
          required
          maxLength={120}
          disabled={disabled}
          aria-describedby={errorId}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-start`} className="text-sm font-medium">
          시작 <span className="text-destructive" aria-hidden="true">*</span>
        </label>
        <Input
          id={`${idPrefix}-start`}
          name="startTime"
          type="datetime-local"
          value={values.startTime}
          onChange={(event) => update("startTime", event.target.value)}
          required
          disabled={disabled}
          aria-describedby={errorId}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-end`} className="text-sm font-medium">
          종료 <span className="text-muted-foreground text-xs">(선택)</span>
        </label>
        <Input
          id={`${idPrefix}-end`}
          name="endTime"
          type="datetime-local"
          value={values.endTime}
          onChange={(event) => update("endTime", event.target.value)}
          disabled={disabled}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-desc`} className="text-sm font-medium">
          메모 <span className="text-muted-foreground text-xs">(선택)</span>
        </label>
        <textarea
          id={`${idPrefix}-desc`}
          name="description"
          value={values.description}
          onChange={(event) => update("description", event.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="추가 메모..."
          disabled={disabled}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none disabled:opacity-50"
        />
      </div>
    </>
  );
}
