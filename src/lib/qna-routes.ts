import { safeReturnPath } from "@/lib/safe-return-path";

export function buildQnaListHref(returnTo?: string): string {
  const safeReturnTo = safeReturnPath(returnTo, "/dashboard/student?section=today");
  return `/dashboard/qna?returnTo=${encodeURIComponent(safeReturnTo)}`;
}
