import { safeReturnPath } from "@/lib/safe-return-path";
import type { QnaFilterTab } from "@/lib/qna-status";

export function resolveQnaFilter(value: unknown): QnaFilterTab {
  return value === "OPEN" || value === "ANSWERED" || value === "CLOSED" ? value : "ALL";
}

export function buildQnaFilterHref(listPath: string, filter: QnaFilterTab): string {
  const url = new URL(safeReturnPath(listPath, "/dashboard/qna"), "https://portal.local");
  if (filter === "ALL") url.searchParams.delete("qnaStatus");
  else url.searchParams.set("qnaStatus", filter);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function buildQnaSearchHref(listPath: string, query: string): string {
  const url = new URL(safeReturnPath(listPath, "/dashboard/qna"), "https://portal.local");
  if (query) url.searchParams.set("qnaQuery", query);
  else url.searchParams.delete("qnaQuery");
  return `${url.pathname}${url.search}${url.hash}`;
}

/** 관리자 Q&A 목록의 학생 필터(`qnaStudent`). 빈 값이면 전체 학생. */
export function buildQnaStudentHref(listPath: string, studentId: string | null): string {
  const url = new URL(safeReturnPath(listPath, "/dashboard/qna"), "https://portal.local");
  if (studentId) url.searchParams.set("qnaStudent", studentId);
  else url.searchParams.delete("qnaStudent");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function buildQnaListHref(returnTo?: string, filter: QnaFilterTab = "ALL", query = "", studentId: string | null = null): string {
  const safeReturnTo = safeReturnPath(returnTo, "/dashboard/student?section=today");
  return buildQnaStudentHref(
    buildQnaSearchHref(buildQnaFilterHref(`/dashboard/qna?returnTo=${encodeURIComponent(safeReturnTo)}`, filter), query),
    studentId,
  );
}
