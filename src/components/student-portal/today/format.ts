import { formatKst } from "@/lib/kst-format";
import { kstDayKeyToDate, type AgendaEntry } from "@/lib/student-today";

export function formatHomeTime(date: Date): string {
  return formatKst(date, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** 오늘 목록의 시각 칸: 종일 일정과 날짜만 있는 노트는 종일, 앞날부터 이어지는 일정은 이어짐으로 표시한다. */
export function formatAgendaWhen(entry: AgendaEntry): string {
  if (entry.kind === "allDay" || entry.kind === "note") return "종일";
  if (entry.continued) return "이어짐";
  return formatHomeTime(entry.item.date);
}

export function formatUpcomingDay(dayKey: string, offset: number): string {
  const label = formatKst(kstDayKeyToDate(dayKey), { month: "long", day: "numeric", weekday: "short" });
  if (offset === 1) return `내일 · ${label}`;
  if (offset === 2) return `모레 · ${label}`;
  return label;
}
