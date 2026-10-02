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

export function buildQnaListHref(returnTo?: string, filter: QnaFilterTab = "ALL"): string {
  const safeReturnTo = safeReturnPath(returnTo, "/dashboard/student?section=today");
  return buildQnaFilterHref(`/dashboard/qna?returnTo=${encodeURIComponent(safeReturnTo)}`, filter);
}
