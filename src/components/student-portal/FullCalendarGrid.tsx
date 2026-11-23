/**
 * @file src/components/student-portal/FullCalendarGrid.tsx
 * @description 넓은 화면 월·주 달력(FullCalendar와 plugin). 코드가 커서 UnifiedCalendar가 따로 내려받는다
 * (첫 화면 JS에서 빼고, 화면이 뜬 뒤 한가할 때 미리 받는다). 받는 동안은 UnifiedCalendar의 같은 높이 빈 판이 보인다.
 */
"use client";

import { useState, type Ref } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import koLocale from "@fullcalendar/core/locales/ko";
import type { CalendarOptions } from "@fullcalendar/core";

const CALENDAR_PLUGINS = [dayGridPlugin, timeGridPlugin, interactionPlugin];

export type FullCalendarGridProps = Omit<CalendarOptions, "plugins" | "locale"> & {
  calendarRef: Ref<FullCalendar>;
};

export function FullCalendarGrid({ calendarRef, initialView, ...options }: FullCalendarGridProps) {
  // 처음 보기는 내려받은 뒤 붙는 순간의 보기다. 그 뒤 보기 전환은 UnifiedCalendar가 api로 맡는다.
  const [firstView] = useState(initialView);
  return (
    <FullCalendar
      ref={calendarRef}
      plugins={CALENDAR_PLUGINS}
      locale={koLocale}
      initialView={firstView}
      {...options}
    />
  );
}
