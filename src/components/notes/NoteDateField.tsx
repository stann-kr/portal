"use client";

import { formatNoteLongDate } from "./note-display";

/** "YYYY-MM-DD"(KST 날짜)를 그날 KST 자정 시각으로 바꾼다. */
function kstDayStart(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00+09:00`);
  return Number.isFinite(time) ? time : null;
}

/**
 * 노트 "날짜" 속성(NoteDoc 보드): 평소에는 "2026년 10월 26일 (월)" 글자로 보이고, 누르면 브라우저 날짜 선택을 연다.
 * 실제 조작은 글자 위에 투명하게 겹친 native date input이 맡아 label·키보드·화면 읽기·form 값이 그대로 동작한다.
 */
export function NoteDateField({
  id,
  name,
  value,
  onChange,
  disabled,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <span className="relative -mx-1.5 inline-flex min-h-11 items-center md:min-h-0">
      <input
        id={id}
        name={name}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onClick={(event) => {
          try {
            event.currentTarget.showPicker?.();
          } catch {
            // 선택 창을 열 수 없는 환경에서는 브라우저 기본 날짜 입력 동작을 쓴다.
          }
        }}
        disabled={disabled}
        className="peer absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-default [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:size-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none rounded-md px-1.5 py-0.5 text-md text-foreground transition-colors peer-hover:bg-muted peer-focus-visible:outline-2 peer-focus-visible:outline-ring peer-disabled:opacity-50 md:text-body"
      >
        {formatNoteLongDate(kstDayStart(value))}
      </span>
    </span>
  );
}
