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
