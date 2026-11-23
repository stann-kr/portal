import { STUDENT_LEGACY_REDIRECTS } from "@/lib/legacy-dashboard-routes";
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

/** 디깅 피드백 한 날의 id(학생 디깅 화면·관리자 학생 상세 디깅 탭). 알림과 관리자 디깅 화면이 이 자리로 바로 간다. */
export function diggingFeedbackAnchorId(dugOn: string): string {
  return `digging-day-${dugOn}`;
}

/** 학생 상세 과제 탭에서 과제 한 줄의 id(전체 과제 화면이 이 줄로 바로 간다). */
export function assignmentTaskAnchorId(taskId: string): string {
  return `assignment-task-${taskId}`;
}

/** 학생 디깅 보드의 기본 복귀 위치: 워크스페이스 전체 항목의 디깅 필터. */
export const STUDENT_DIGGING_TIMELINE_HREF = "/dashboard/student?section=workspace&view=all&type=DIGGING";

export function buildStudentDiggingBoardHref(returnTo?: string): string {
  return returnTo
    ? `/dashboard/student/digging?returnTo=${encodeURIComponent(returnTo)}`
    : "/dashboard/student/digging";
}

/** 학생 믹스셋 분석 작성·수정 화면(AnalysisWrite·MobileAnalysisWrite 보드). returnTo가 있으면 뒤로·취소가 그 화면으로 간다. */
export function analysisWriteHref(taskId: string, returnTo?: string): string {
  const base = `/dashboard/student/assignments/analysis/${encodeURIComponent(taskId)}`;
  return returnTo ? `${base}?returnTo=${encodeURIComponent(returnTo)}` : base;
}

/** 학생 과제 목록에서 특정 과제를 펼치는 주소. 분석(믹스셋 분석) 과제는 작성 화면으로 보낸다. */
export function assignmentTaskHref(taskId: string, options: { analysis?: boolean; returnTo?: string } = {}): string {
  if (options.analysis) return analysisWriteHref(taskId, options.returnTo);
  // 정식 주소로 바로 연다. 예전 `/dashboard/student/assignments?task=`는 서버 redirect를 한 번 더 거쳤다.
  return `${STUDENT_LEGACY_REDIRECTS.assignments}&task=${encodeURIComponent(taskId)}`;
}
