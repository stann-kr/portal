export const STUDENT_DETAIL_TABS = ["overview", "assignments", "digging", "notes", "qna"] as const;
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

/** 학생 믹스셋 분석 작성·수정 화면(AnalysisWrite·MobileAnalysisWrite 보드). */
export function analysisWriteHref(taskId: string): string {
  return `/dashboard/student/assignments/analysis/${encodeURIComponent(taskId)}`;
}

/** 학생 과제 목록에서 특정 과제를 펼치는 주소. 분석(믹스셋 분석) 과제는 작성 화면으로 보낸다. */
export function assignmentTaskHref(taskId: string, options: { analysis?: boolean } = {}): string {
  if (options.analysis) return analysisWriteHref(taskId);
  return `/dashboard/student/assignments?task=${encodeURIComponent(taskId)}`;
}
