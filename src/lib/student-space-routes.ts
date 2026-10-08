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

/** 학생 디깅 보드의 기본 복귀 위치: 워크스페이스 전체 항목의 디깅 필터. */
export const STUDENT_DIGGING_TIMELINE_HREF = "/dashboard/student?section=workspace&view=all&type=DIGGING";

export function buildStudentDiggingBoardHref(returnTo?: string): string {
  return returnTo
    ? `/dashboard/student/digging?returnTo=${encodeURIComponent(returnTo)}`
    : "/dashboard/student/digging";
}
