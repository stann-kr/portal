import type { UnifiedItem, UnifiedItemType } from "@/lib/utils/unifiedItemUtils";

export type CalendarWorkspaceRole = "admin" | "student";
export type CalendarTabValue = "calendar" | "daily" | "all" | "curriculum" | "assignments";
export type CalendarPreset = "notes-lessons";

export const CALENDAR_TABS: ReadonlyArray<{
  value: CalendarTabValue;
  label: string;
  roles: readonly CalendarWorkspaceRole[];
}> = [
  { value: "calendar", label: "캘린더", roles: ["admin", "student"] },
  { value: "daily", label: "일별 목록", roles: ["admin", "student"] },
  { value: "all", label: "전체 항목", roles: ["admin", "student"] },
  { value: "curriculum", label: "커리큘럼", roles: ["student"] },
  { value: "assignments", label: "과제", roles: ["student"] },
];

export function getCalendarTabs(role: CalendarWorkspaceRole) {
  return CALENDAR_TABS.filter((tab) => tab.roles.includes(role));
}

export function resolveCalendarTab(value: string | null, role: CalendarWorkspaceRole): CalendarTabValue {
  return getCalendarTabs(role).some((tab) => tab.value === value)
    ? value as CalendarTabValue
    : "calendar";
}

export function resolveCalendarPreset(value: string | null): CalendarPreset | null {
  return value === "notes-lessons" ? value : null;
}

const UNIFIED_ITEM_TYPES = new Set<UnifiedItemType>(["EVENT", "NOTE", "DIGGING", "QNA", "ASSIGNMENT"]);

export function resolveUnifiedItemType(value: string | null): UnifiedItemType | null {
  return value && UNIFIED_ITEM_TYPES.has(value as UnifiedItemType)
    ? value as UnifiedItemType
    : null;
}

export function matchesCalendarPreset(item: UnifiedItem, preset: CalendarPreset | null): boolean {
  if (!preset) return true;
  return item.type === "NOTE" || (item.type === "EVENT" && item.subType === "LESSON");
}

export function buildNotesLessonsTimelineHref(input: {
  role: CalendarWorkspaceRole;
  studentId?: string;
}): string {
  const pathname = input.role === "student" ? "/dashboard/student" : "/dashboard/admin";
  const params = new URLSearchParams({
    section: input.role === "student" ? "workspace" : "schedule",
    view: "calendar",
    preset: "notes-lessons",
  });
  if (input.role === "admin" && input.studentId) params.set("student", input.studentId);
  return `${pathname}?${params.toString()}`;
}
