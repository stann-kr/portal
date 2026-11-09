import type {
  UnifiedItem,
  UnifiedItemType,
} from "@/lib/utils/unifiedItemUtils";

export const UNIFIED_ITEMS_DEFAULT_PAST_DAYS = 365;
export const UNIFIED_ITEMS_DEFAULT_FUTURE_DAYS = 365;
export const UNIFIED_ITEMS_DEFAULT_LIMIT = 300;
export const UNIFIED_ITEMS_MAX_LIMIT = 500;
export const UNIFIED_ITEMS_PER_SOURCE_LIMIT = 200;
export const UNIFIED_ITEMS_MAX_RANGE_DAYS = 1_095;

const DAY_MS = 24 * 60 * 60 * 1_000;
const UNIFIED_ITEM_TYPES = [
  "EVENT",
  "NOTE",
  "DIGGING",
  "QNA",
  "ASSIGNMENT",
] as const satisfies readonly UnifiedItemType[];
const UNIFIED_ITEM_TYPE_SET = new Set<string>(UNIFIED_ITEM_TYPES);

export type UnifiedItemsQueryInput = {
  /** ISO timestamp 또는 YYYY-MM-DD. start와 end는 함께 전달한다. */
  start?: string;
  /** ISO timestamp 또는 YYYY-MM-DD. date-only end는 해당 날짜 끝으로 해석한다. */
  end?: string;
  types?: readonly UnifiedItemType[];
  limit?: number;
};

export type ResolvedUnifiedItemsQuery = {
  start: Date;
  end: Date;
  types: readonly UnifiedItemType[];
  limit: number;
  perSourceLimit: number;
};

function defaultBoundary(referenceTime: Date, dayOffset: number, end: boolean): Date {
  const value = new Date(referenceTime);
  value.setUTCHours(end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
  value.setUTCDate(value.getUTCDate() + dayOffset);
  return value;
}

function parseBoundary(value: string, end: boolean): Date {
  const trimmed = value.trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/u.test(trimmed)
    ? `${trimmed}T${end ? "23:59:59.999" : "00:00:00.000"}Z`
    : trimmed;
  const parsed = new Date(normalized);
  if (!trimmed || !Number.isFinite(parsed.getTime())) {
    throw new TypeError("일정 조회 기간 형식이 올바르지 않습니다.");
  }
  return parsed;
}

export function resolveUnifiedItemsQuery(
  input: UnifiedItemsQueryInput | undefined,
  referenceTime: Date = new Date(),
): ResolvedUnifiedItemsQuery {
  if (!Number.isFinite(referenceTime.getTime())) {
    throw new TypeError("일정 조회 기준 시각이 올바르지 않습니다.");
  }
  if (Boolean(input?.start) !== Boolean(input?.end)) {
    throw new TypeError("일정 조회의 시작과 끝은 함께 지정해야 합니다.");
  }

  const start = input?.start
    ? parseBoundary(input.start, false)
    : defaultBoundary(referenceTime, -UNIFIED_ITEMS_DEFAULT_PAST_DAYS, false);
  const end = input?.end
    ? parseBoundary(input.end, true)
    : defaultBoundary(referenceTime, UNIFIED_ITEMS_DEFAULT_FUTURE_DAYS, true);
  if (start.getTime() > end.getTime()) {
    throw new RangeError("일정 조회 시작은 끝보다 늦을 수 없습니다.");
  }
  if (end.getTime() - start.getTime() > UNIFIED_ITEMS_MAX_RANGE_DAYS * DAY_MS) {
    throw new RangeError(`일정 조회 기간은 ${UNIFIED_ITEMS_MAX_RANGE_DAYS}일 이하여야 합니다.`);
  }

  const types = input?.types === undefined
    ? [...UNIFIED_ITEM_TYPES]
    : [...new Set(input.types)];
  if (types.some((type) => !UNIFIED_ITEM_TYPE_SET.has(type))) {
    throw new TypeError("지원하지 않는 일정 항목 타입입니다.");
  }

  const limit = input?.limit ?? UNIFIED_ITEMS_DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > UNIFIED_ITEMS_MAX_LIMIT) {
    throw new RangeError(`일정 조회 결과 수는 1~${UNIFIED_ITEMS_MAX_LIMIT} 사이여야 합니다.`);
  }

  return {
    start,
    end,
    types,
    limit,
    perSourceLimit: Math.min(limit, UNIFIED_ITEMS_PER_SOURCE_LIMIT),
  };
}

export function selectUnifiedItemsWithinQuery(
  items: readonly UnifiedItem[],
  query: ResolvedUnifiedItemsQuery,
): UnifiedItem[] {
  const acceptedTypes = new Set<UnifiedItemType>(query.types);
  const startMs = query.start.getTime();
  const endMs = query.end.getTime();
  return items
    .filter((item) => {
      const itemTime = item.date.getTime();
      return acceptedTypes.has(item.type) && itemTime >= startMs && itemTime <= endMs;
    })
    .sort((left, right) => right.date.getTime() - left.date.getTime())
    .slice(0, query.limit);
}

// ── 관리자 일정 "전체 학생" ─────────────────────────
// 여러 학생을 한 번에 보므로 한 학생 보기(±365일·300건)처럼 넓게 읽지 않고, 보이는 달 앞뒤만 읽는다.
// 달력이 이 범위 밖으로 넘어가면 그 달 기준 범위를 더 읽어 합친다.

/** 한 번에 읽는 기간 상한: 앞 달 1일 ~ 두 달 뒤 말일(넉 달, 최대 123일). */
export const ALL_STUDENTS_ITEMS_MAX_RANGE_DAYS = 124;
/** 한 번에 돌려주는 항목 상한. 넉 달 동안 학생 여럿의 레슨·노트·과제가 들어갈 만큼. */
export const ALL_STUDENTS_ITEMS_LIMIT = 1_000;
/** 학생 묶음(최대 90명) 하나에서 소스별로 읽는 행 상한. */
export const ALL_STUDENTS_ITEMS_PER_SOURCE_LIMIT = 500;

const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;

export type UnifiedItemsWindow = { start: Date; end: Date };

/**
 * 기준 날짜(KST)가 속한 달의 앞 달 1일 00:00 ~ 두 달 뒤 말일 23:59:59.999(KST)를 돌려준다.
 * 월 달력은 앞뒤 달 날짜를 함께 그리므로 앞 달을 넣고, 다음 달로 넘겨도 다시 읽지 않게 두 달 뒤까지 둔다.
 */
export function getAllStudentsItemsWindow(reference: Date): UnifiedItemsWindow {
  if (!Number.isFinite(reference.getTime())) {
    throw new TypeError("일정 조회 기준 시각이 올바르지 않습니다.");
  }
  const kst = new Date(reference.getTime() + KST_OFFSET_MS);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - KST_OFFSET_MS),
    end: new Date(Date.UTC(year, month + 3, 1) - KST_OFFSET_MS - 1),
  };
}

/** 이미 읽은 범위들이 [start, end]를 덮는지. */
export function isWindowCovered(windows: readonly UnifiedItemsWindow[], start: Date, end: Date): boolean {
  return windows.some((window) => window.start.getTime() <= start.getTime() && window.end.getTime() >= end.getTime());
}

/** "전체 학생" 조회 범위: ISO start·end(함께, 124일 이하) 또는 기준 시각의 기본 범위. 모든 내부 항목 유형을 읽는다. */
export function resolveAllStudentsItemsQuery(
  input: { start?: string; end?: string } | undefined,
  referenceTime: Date = new Date(),
): ResolvedUnifiedItemsQuery {
  if (Boolean(input?.start) !== Boolean(input?.end)) {
    throw new TypeError("일정 조회의 시작과 끝은 함께 지정해야 합니다.");
  }
  const fallback = getAllStudentsItemsWindow(referenceTime);
  const start = input?.start ? parseBoundary(input.start, false) : fallback.start;
  const end = input?.end ? parseBoundary(input.end, true) : fallback.end;
  if (start.getTime() > end.getTime()) {
    throw new RangeError("일정 조회 시작은 끝보다 늦을 수 없습니다.");
  }
  if (end.getTime() - start.getTime() > ALL_STUDENTS_ITEMS_MAX_RANGE_DAYS * DAY_MS) {
    throw new RangeError(`전체 학생 일정 조회 기간은 ${ALL_STUDENTS_ITEMS_MAX_RANGE_DAYS}일 이하여야 합니다.`);
  }
  return {
    start,
    end,
    types: [...UNIFIED_ITEM_TYPES],
    limit: ALL_STUDENTS_ITEMS_LIMIT,
    perSourceLimit: ALL_STUDENTS_ITEMS_PER_SOURCE_LIMIT,
  };
}
