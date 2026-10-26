import { toKstDateInputValue } from "@/lib/date-input";
import type { UnifiedItem } from "@/lib/utils/unifiedItemUtils";

export type StudentTodaySummary = {
  nextCue: UnifiedItem | null;
  feedbackItems: UnifiedItem[];
  answeredQnaItems: UnifiedItem[];
  waitingAssignment: UnifiedItem | null;
  openQnaItems: UnifiedItem[];
};

function newestFirst(a: UnifiedItem, b: UnifiedItem) {
  return b.date.getTime() - a.date.getTime();
}

function oldestFirst(a: UnifiedItem, b: UnifiedItem) {
  return a.date.getTime() - b.date.getTime();
}

function feedbackCount(item: UnifiedItem): number {
  const count = item.metadata.feedbackCount;
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}

export function getStudentTodaySummary(
  items: UnifiedItem[],
  referenceTime: Date,
): StudentTodaySummary {
  const futureEvents = items
    .filter(
      (item) =>
        item.type === "EVENT" && item.date.getTime() >= referenceTime.getTime(),
    )
    .sort(oldestFirst);
  const nextCue =
    futureEvents.find((item) => item.subType === "LESSON") ??
    futureEvents[0] ??
    null;

  const assignments = items
    .filter((item) => item.type === "ASSIGNMENT")
    .sort(newestFirst);
  const qnaItems = items.filter((item) => item.type === "QNA").sort(newestFirst);

  return {
    nextCue,
    feedbackItems: assignments.filter((item) => feedbackCount(item) > 0).slice(0, 3),
    answeredQnaItems: qnaItems
      .filter((item) => item.subType === "ANSWERED")
      .slice(0, 3),
    waitingAssignment:
      assignments.find((item) => feedbackCount(item) === 0) ?? null,
    openQnaItems: qnaItems.filter((item) => item.subType === "OPEN").slice(0, 3),
  };
}

// ─── 홈(오늘) 화면 파생 데이터 ─────────────────────────────
// 화면은 render 중 현재 시각을 읽지 않고 서버가 넘긴 referenceTime만 기준으로 삼는다.
// 날짜 경계는 실행 환경과 무관하게 KST(UTC+9) 달력 날짜로 계산한다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/** KST 달력 날짜 키(YYYY-MM-DD). */
export function toKstDayKey(date: Date): string {
  return toKstDateInputValue(date);
}

/** 날짜 키에 일 수를 더한다. 키는 KST 달력 날짜이므로 UTC 산술로 충분하다. */
export function addDaysToDayKey(dayKey: string, days: number): string {
  const base = Date.parse(`${dayKey}T00:00:00.000Z`);
  return new Date(base + days * DAY_MS).toISOString().slice(0, 10);
}

/** 날짜 키의 KST 자정 시각. 화면에서 요일·날짜를 표시할 때 쓴다. */
export function kstDayKeyToDate(dayKey: string): Date {
  return new Date(Date.parse(`${dayKey}T00:00:00.000Z`) - KST_OFFSET_MS);
}

export function isAllDayItem(item: UnifiedItem): boolean {
  return item.metadata.allDay === true;
}

/** 일정이 시작하는 KST 날짜와 끝나는 날짜(포함)를 구한다. */
function eventDayRange(item: UnifiedItem): { start: string; end: string } {
  if (isAllDayItem(item)) {
    const startRaw = item.metadata.allDayStartDate;
    const endRaw = item.metadata.allDayEndDate;
    const start = typeof startRaw === "string" && DATE_KEY_PATTERN.test(startRaw)
      ? startRaw
      : toKstDayKey(item.date);
    // iCal 종일 일정의 종료 날짜는 배타적이다.
    const endExclusive = typeof endRaw === "string" && DATE_KEY_PATTERN.test(endRaw) && endRaw > start
      ? endRaw
      : addDaysToDayKey(start, 1);
    return { start, end: addDaysToDayKey(endExclusive, -1) };
  }
  const start = toKstDayKey(item.date);
  const endTime = item.endDate?.getTime();
  if (endTime === undefined || endTime <= item.date.getTime()) return { start, end: start };
  const end = toKstDayKey(new Date(endTime - 1));
  return { start, end: end < start ? start : end };
}

export type AgendaEntryKind = "allDay" | "timed" | "note";

export type AgendaEntry = {
  item: UnifiedItem;
  kind: AgendaEntryKind;
  /** 오늘보다 앞서 시작해 오늘까지 이어지는 일정 */
  continued: boolean;
};

const KIND_ORDER: Record<AgendaEntryKind, number> = { allDay: 0, timed: 1, note: 2 };

function compareAgenda(a: AgendaEntry, b: AgendaEntry) {
  if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (a.kind === "timed" && a.continued !== b.continued) return a.continued ? -1 : 1;
  const byTime = a.item.date.getTime() - b.item.date.getTime();
  return byTime !== 0 ? byTime : a.item.title.localeCompare(b.item.title, "ko");
}

/** 오늘(KST)의 일정과 오늘 날짜 노트를 종일 → 시간순 → 노트 순서로 정렬한다. */
export function getStudentTodayAgenda(items: UnifiedItem[], referenceTime: Date): AgendaEntry[] {
  const today = toKstDayKey(referenceTime);
  const entries: AgendaEntry[] = [];
  for (const item of items) {
    if (item.type === "EVENT") {
      const range = eventDayRange(item);
      if (range.start > today || range.end < today) continue;
      entries.push({
        item,
        kind: isAllDayItem(item) ? "allDay" : "timed",
        continued: range.start < today,
      });
    } else if (item.type === "NOTE" && toKstDayKey(item.date) === today) {
      entries.push({ item, kind: "note", continued: false });
    }
  }
  return entries.sort(compareAgenda);
}

export type UpcomingDayGroup = {
  dayKey: string;
  /** 오늘 기준 며칠 뒤인지(1 = 내일) */
  offset: number;
  entries: AgendaEntry[];
};

export type StudentUpcomingSchedule = {
  groups: UpcomingDayGroup[];
  /** 기간 안의 전체 일정 수(표시 한도로 잘린 항목 포함) */
  totalCount: number;
  shownCount: number;
};

/** 내일부터 days일 동안 시작하는 일정을 날짜별로 묶고, 전체 행 수를 limit으로 제한한다. */
export function getStudentUpcomingSchedule(
  items: UnifiedItem[],
  referenceTime: Date,
  { days = 7, limit = 8 }: { days?: number; limit?: number } = {},
): StudentUpcomingSchedule {
  const today = toKstDayKey(referenceTime);
  const first = addDaysToDayKey(today, 1);
  const last = addDaysToDayKey(today, days);
  const entries = items
    .filter((item) => item.type === "EVENT")
    .map((item) => ({ item, dayKey: eventDayRange(item).start }))
    .filter(({ dayKey }) => dayKey >= first && dayKey <= last)
    .map(({ item, dayKey }) => ({
      dayKey,
      entry: { item, kind: isAllDayItem(item) ? "allDay" : "timed", continued: false } as AgendaEntry,
    }))
    .sort((a, b) => (a.dayKey === b.dayKey ? compareAgenda(a.entry, b.entry) : a.dayKey < b.dayKey ? -1 : 1));

  const shown = entries.slice(0, Math.max(0, limit));
  const groups: UpcomingDayGroup[] = [];
  for (const { dayKey, entry } of shown) {
    const current = groups.at(-1);
    if (current?.dayKey === dayKey) {
      current.entries.push(entry);
    } else {
      const offset = Math.round(
        (Date.parse(`${dayKey}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / DAY_MS,
      );
      groups.push({ dayKey, offset, entries: [entry] });
    }
  }
  return { groups, totalCount: entries.length, shownCount: shown.length };
}

export type RecentNote = {
  item: UnifiedItem;
  preview: string;
};

/** 노트 날짜가 가까운 순서로 최근 노트를 고른다. 아직 오지 않은 날짜의 노트는 뒤로 미룬다. */
export function getStudentRecentNotes(
  items: UnifiedItem[],
  referenceTime: Date,
  limit = 5,
): RecentNote[] {
  const today = toKstDayKey(referenceTime);
  const notes = items.filter((item) => item.type === "NOTE");
  const isFuture = (item: UnifiedItem) => toKstDayKey(item.date) > today;
  return notes
    .sort((a, b) => {
      const futureA = isFuture(a);
      const futureB = isFuture(b);
      if (futureA !== futureB) return futureA ? 1 : -1;
      // 지난 노트는 최근 순, 앞으로의 노트는 가까운 순.
      return futureA ? oldestFirst(a, b) : newestFirst(a, b);
    })
    .slice(0, Math.max(0, limit))
    .map((item) => ({
      item,
      preview: typeof item.metadata.preview === "string" ? item.metadata.preview.trim() : "",
    }));
}

export type StudentTodoStatus = "feedbackReady" | "qnaAnswered" | "feedbackWaiting" | "qnaOpen";

export type StudentTodoEntry = {
  item: UnifiedItem;
  status: StudentTodoStatus;
};

/** 확인할 항목: 도착한 피드백 → 답변된 질문 → 피드백 대기 과제 → 답변 대기 질문 순서. */
export function getStudentTodoEntries(summary: StudentTodaySummary, limit = 5): StudentTodoEntry[] {
  return [
    ...summary.feedbackItems.map((item) => ({ item, status: "feedbackReady" as const })),
    ...summary.answeredQnaItems.map((item) => ({ item, status: "qnaAnswered" as const })),
    ...(summary.waitingAssignment
      ? [{ item: summary.waitingAssignment, status: "feedbackWaiting" as const }]
      : []),
    ...summary.openQnaItems.map((item) => ({ item, status: "qnaOpen" as const })),
  ].slice(0, Math.max(0, limit));
}

const EVENT_KIND_LABELS: Record<string, string> = {
  LESSON: "레슨",
  PRACTICE: "연습",
  GIG: "공연·행사",
  NOTE: "메모",
};

/** 홈 일정 행의 짧은 유형 이름. 외부 캘린더 일정은 출처 이름을 쓴다. */
export function describeAgendaKind(item: UnifiedItem): string {
  if (item.type === "NOTE") return "노트";
  if (item.source.kind !== "PORTAL") return item.source.label;
  return EVENT_KIND_LABELS[item.subType ?? ""] ?? "일정";
}
