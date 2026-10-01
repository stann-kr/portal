import {
  resolveCalendarPreset,
  resolveCalendarTab,
  resolveUnifiedItemType,
  type CalendarWorkspaceRole,
} from "@/lib/calendar-section-contract";

export type PortalSearchParams = Record<string, string | string[] | undefined>;

const SECTIONS = {
  student: ["today", "workspace", "community"],
  admin: ["work", "students", "schedule", "announcements", "community"],
} as const;

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
