export const STUDENT_DETAIL_TABS = ["overview", "digging", "notes", "qna"] as const;
export type StudentDetailTab = (typeof STUDENT_DETAIL_TABS)[number];

export function resolveStudentDetailTab(value: string | null | undefined): StudentDetailTab {
  return STUDENT_DETAIL_TABS.includes(value as StudentDetailTab)
    ? value as StudentDetailTab
    : "overview";
}

export function buildAdminStudentDetailHref(studentId: string, tab: StudentDetailTab): string {
  return `/dashboard/admin/students/${encodeURIComponent(studentId)}?tab=${tab}`;
}
