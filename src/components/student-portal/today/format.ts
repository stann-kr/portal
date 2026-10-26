import { formatKst, type KstDateInput } from "@/lib/kst-format";
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

/**
 * 캔버스 목록의 점 날짜(10.28, 10.28 (수) 19:00). 기준 시각과 연도가 다르면 앞에 연도를 붙인다.
 * 학생 홈·관리자 업무함·학생 관리가 함께 쓰는 표시 전용 helper다.
 */
export function formatKstDot(
  value: KstDateInput,
  { weekday = false, time = false, referenceTime }: { weekday?: boolean; time?: boolean; referenceTime?: Date } = {},
): string {
  const [year, month, day] = formatKst(value, { year: "numeric", month: "2-digit", day: "2-digit" }).match(/\d+/gu) ?? [];
  if (!year || !month || !day) return "";
  const sameYear = !referenceTime || formatKst(referenceTime, { year: "numeric" }).includes(year);
  let label = sameYear ? `${month}.${day}` : `${year}.${month}.${day}`;
  if (weekday) label += ` (${formatKst(value, { weekday: "short" })})`;
  if (time) label += ` ${formatKst(value, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
  return label;
}
