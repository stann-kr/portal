import {
  resolveCalendarPreset,
  resolveCalendarTab,
  resolveUnifiedItemType,
  type CalendarWorkspaceRole,
} from "@/lib/calendar-section-contract";

export type PortalSearchParams = Record<string, string | string[] | undefined>;

const SECTIONS = {
  student: ["today", "workspace"],
  admin: ["work", "students", "schedule"],
} as const;

/**
 * 커뮤니티·공지는 `/community` 한 곳에 있다. 예전 포탈 구역 주소(`?section=community`, 관리자 `?section=announcements`)는
 * 같은 내용을 여는 커뮤니티 주소로 보낸다. 해당하지 않으면 null.
 */
export function legacyPortalSectionRedirect(params: PortalSearchParams): string | null {
  const section = firstSearchValue(params.section);
  if (section === "community") return "/community";
  if (section === "announcements") return "/community?boardType=ANNOUNCEMENT";
  return null;
}

export type PortalSection<Role extends CalendarWorkspaceRole> = (typeof SECTIONS)[Role][number];

export function firstSearchValue(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/** Server and client start with the same validated URL location. */
export function resolvePortalLocation<Role extends CalendarWorkspaceRole>(role: Role, params: PortalSearchParams) {
  const section = firstSearchValue(params.section);
  const sections: readonly string[] = SECTIONS[role];
  return {
    section: (section && sections.includes(section) ? section : sections[0]) as PortalSection<Role>,
    view: resolveCalendarTab(firstSearchValue(params.view), role),
    preset: resolveCalendarPreset(firstSearchValue(params.preset)),
    type: resolveUnifiedItemType(firstSearchValue(params.type)),
  };
}

export type PortalLocation<Role extends CalendarWorkspaceRole> = ReturnType<typeof resolvePortalLocation<Role>>;
export type WorkspaceLocation = Pick<PortalLocation<CalendarWorkspaceRole>, "view" | "preset" | "type">;

// ── 딥링크(알림·오늘 목록에서 특정 항목으로 바로 가기) ─────────────────

const DEEP_LINK_ID_PATTERN = /^[A-Za-z0-9_.@:-]{1,200}$/u;

/** 딥링크 항목 식별자 형식 검사. 존재·소유 확인은 서버 목록과 대조하는 resolveStudentDeepLink가 맡는다. */
export function parseDeepLinkId(value: string | null | undefined): string | null {
  return typeof value === "string" && DEEP_LINK_ID_PATTERN.test(value) ? value : null;
}

/** 엄격한 `YYYY-MM-DD`(실제로 있는 날짜만). */
export function parseCalendarDateParam(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1970 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth ? value : null;
}

/** 주소의 딥링크 값을 형식만 검사해 읽는다(`task`, `date`, `item`). `item`은 `date`와 함께일 때만 받는다. */
export function resolvePortalDeepLink(params: PortalSearchParams) {
  const date = parseCalendarDateParam(firstSearchValue(params.date));
  return {
    taskId: parseDeepLinkId(firstSearchValue(params.task)),
    date,
    itemId: date ? parseDeepLinkId(firstSearchValue(params.item)) : null,
  };
}

export type PortalDeepLink = ReturnType<typeof resolvePortalDeepLink>;

/**
 * 딥링크 항목을 키(`kind:entity:id`) 또는 id로 찾는다. id가 여러 항목에 겹치면 고르지 않는다.
 * 항목 목록은 서버가 이미 현재 학생 범위로 읽은 것이어야 한다.
 */
export function findDeepLinkedItem<T extends { id: string }>(
  items: readonly T[],
  itemId: string | null,
  keyOf: (item: T) => string,
): T | null {
  if (!itemId) return null;
  const byKey = items.find((item) => keyOf(item) === itemId);
  if (byKey) return byKey;
  const byId = items.filter((item) => item.id === itemId);
  return byId.length === 1 ? byId[0]! : null;
}

export type StudentDeepLink = {
  /** 과제 목록에서 펼칠 과제(현재 학생 것만). */
  initialOpenTaskId: string | null;
  /** 캘린더가 처음 보여 줄 날짜(YYYY-MM-DD). */
  calendarDate: string | null;
  /** 캘린더에서 처음 열 항목 키(`kind:entity:id`, 현재 학생 목록에 있는 것만). */
  calendarItemKey: string | null;
};

/** 학생 딥링크를 현재 학생의 과제·항목 목록과 대조한다. 목록에 없으면 버린다(다른 학생 것·없는 것). */
export function resolveStudentDeepLink<Item extends { id: string }>(
  deepLink: PortalDeepLink,
  owned: { taskIds: readonly string[]; items: readonly Item[]; keyOf: (item: Item) => string },
): StudentDeepLink {
  const item = findDeepLinkedItem(owned.items, deepLink.itemId, owned.keyOf);
  return {
    initialOpenTaskId: deepLink.taskId && owned.taskIds.includes(deepLink.taskId) ? deepLink.taskId : null,
    calendarDate: deepLink.date,
    calendarItemKey: item ? owned.keyOf(item) : null,
  };
}

/** 학생 캘린더의 특정 날짜로 가서 그 항목 상세를 여는 주소. */
export function calendarItemHref(date: string, itemId?: string | null): string {
  const query = new URLSearchParams({ section: "workspace", view: "calendar", date });
  if (itemId) query.set("item", itemId);
  return `/dashboard/student?${query.toString()}`;
}
