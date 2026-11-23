/**
 * 관리자 "새 노트"·"과제 내기" 주소(캔버스 AdminUx1123). 대상을 고른 뒤 이미 있는 작성 화면(노트 composer, 학생 상세 과제 탭 폼)을
 * 연다. 작성 화면이 local draft·이탈 보호·소유권 확인을 그대로 맡고, 저장하거나 닫으면 `returnTo`로 돌아온다.
 */
import { buildAdminStudentDetailHref } from "@/lib/student-space-routes";

/** 학생 상세 과제 탭에서 처음 펼칠 폼(`?compose=`). */
export type AssignmentComposeKind = "task" | "recurrence";

export function resolveAssignmentCompose(value: string | null | undefined): AssignmentComposeKind | null {
  return value === "task" || value === "recurrence" ? value : null;
}

/** 그 학생 과제 탭을 열고 "과제 내기" 폼을 펼친다. returnTo가 있으면 저장·닫기 뒤 그 화면으로 돌아간다. */
export function buildAdminAssignmentComposeHref(studentId: string, returnTo?: string, kind: AssignmentComposeKind = "task"): string {
  const href = `${buildAdminStudentDetailHref(studentId, "assignments")}&compose=${kind}`;
  return returnTo ? `${href}&returnTo=${encodeURIComponent(returnTo)}` : href;
}

/** 그 학생(또는 `space=group`이면 그 학생의 그룹)의 새 노트 composer. */
export function buildAdminNoteComposeHref(studentId: string, options: { returnTo?: string; group?: boolean } = {}): string {
  const params = new URLSearchParams();
  if (options.group) params.set("space", "group");
  if (options.returnTo) params.set("returnTo", options.returnTo);
  const search = params.toString();
  return `/dashboard/admin/students/${encodeURIComponent(studentId)}/notes/new${search ? `?${search}` : ""}`;
}
