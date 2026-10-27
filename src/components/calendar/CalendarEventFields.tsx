"use client";

import { Input } from "@/components/ui/input";
import type { CalendarEventType } from "@/db/schema";
import { cn } from "@/lib/utils";

export type CalendarEventFieldValues = {
  eventType: CalendarEventType;
  title: string;
  startTime: string;
  endTime: string;
  description: string;
};

export const CALENDAR_EVENT_TYPE_OPTIONS: { value: CalendarEventType; label: string; color: string }[] = [
  { value: "LESSON", label: "레슨", color: "bg-event-lesson" },
  { value: "PRACTICE", label: "연습", color: "bg-event-practice" },
  { value: "GIG", label: "공연", color: "bg-event-gig" },
  { value: "NOTE", label: "메모", color: "bg-event-note" },
];

const FIELD_LABEL = "flex flex-col gap-1.5 text-xs text-secondary-foreground";

/**
 * 일정 생성 dialog와 상세 패널 수정 form이 같은 입력 계약을 사용한다(캔버스 CalendarDialogs "새 일정 추가").
 * 유형은 세그먼트 모양의 native radio 묶음이라 화살표 키와 form 값이 그대로 동작한다.
 */
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
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="mb-1.5 p-0 text-xs text-secondary-foreground">유형</legend>
        <div className="flex h-12 gap-0.5 rounded-lg bg-muted p-0.5 md:h-8 md:rounded-md">
          {CALENDAR_EVENT_TYPE_OPTIONS.map(({ value, label }) => (
            <label key={value} className="flex flex-1 cursor-pointer">
              <input
                type="radio"
                name="eventType"
                value={value}
                checked={values.eventType === value}
                onChange={() => update("eventType", value)}
                className="peer sr-only"
                disabled={disabled}
              />
              <span
                className={cn(
                  "flex flex-1 items-center justify-center rounded-touch text-md text-secondary-foreground transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none md:rounded-sm md:text-xs",
                  "peer-checked:bg-background peer-checked:font-medium peer-checked:text-foreground peer-checked:shadow-segment",
                  "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:opacity-50",
                )}
              >
                {label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label htmlFor={`${idPrefix}-title`} className={FIELD_LABEL}>
        제목
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
      </label>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <label htmlFor={`${idPrefix}-start`} className={FIELD_LABEL}>
          시작
          <Input
            id={`${idPrefix}-start`}
            name="startTime"
            type="datetime-local"
            value={values.startTime}
            onChange={(event) => update("startTime", event.target.value)}
            required
            disabled={disabled}
            aria-describedby={errorId}
            className="font-mono md:px-2.5 md:text-xs"
          />
        </label>

        <label htmlFor={`${idPrefix}-end`} className={FIELD_LABEL}>
          종료 (선택)
          <Input
            id={`${idPrefix}-end`}
            name="endTime"
            type="datetime-local"
            value={values.endTime}
            onChange={(event) => update("endTime", event.target.value)}
            disabled={disabled}
            className="font-mono md:px-2.5 md:text-xs"
          />
        </label>
      </div>

      <label htmlFor={`${idPrefix}-desc`} className={FIELD_LABEL}>
        메모 (선택)
        <textarea
          id={`${idPrefix}-desc`}
          name="description"
          value={values.description}
          onChange={(event) => update("description", event.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="추가 메모..."
          disabled={disabled}
          className="min-h-16 w-full resize-none rounded-touch border border-input bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:opacity-50 md:rounded-md md:text-body"
        />
      </label>
    </>
  );
}
