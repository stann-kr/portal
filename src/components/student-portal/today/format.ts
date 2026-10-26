import { formatKst } from "@/lib/kst-format";
import { kstDayKeyToDate, type AgendaEntry } from "@/lib/student-today";

export function formatHomeTime(date: Date): string {
  return formatKst(date, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** 오늘 목록의 시각 칸: 종일·이어짐·노트는 시각 대신 짧은 말로 표시한다. */
export function formatAgendaWhen(entry: AgendaEntry): string {
  if (entry.kind === "allDay") return "종일";
  if (entry.kind === "note") return "노트";
  if (entry.continued) return "이어짐";
  return formatHomeTime(entry.item.date);
}

export function formatUpcomingDay(dayKey: string, offset: number): string {
  const label = formatKst(kstDayKeyToDate(dayKey), { month: "long", day: "numeric", weekday: "short" });
  if (offset === 1) return `내일 · ${label}`;
  if (offset === 2) return `모레 · ${label}`;
  return label;
}
