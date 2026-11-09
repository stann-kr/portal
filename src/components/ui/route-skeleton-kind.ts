/**
 * 화면 모양별 스켈레톤 종류와 주소 → 종류 대응. 각 route의 loading.tsx와
 * 첫 진입 때 셸 자리 스켈레톤(AppShell)이 같은 대응을 쓰도록 한곳에 둔다.
 */
export type RouteSkeletonKind =
  | "generic"
  | "work-queue"
  | "today"
  | "student-detail"
  | "record-list"
  | "record-list-narrow"
  | "history"
  | "thread-list"
  | "document"
  | "editor"
  | "form"
  | "form-narrow"
  | "form-wide"
  | "board"
  | "assignment"
  | "guide-index"
  | "guide-page"
  | "auth"
  | "privacy";

const ID = "[^/]+";

/** 더 구체적인 주소가 먼저 온다. 첫 번째로 맞는 규칙을 쓴다. */
const ROUTE_SKELETON_RULES: ReadonlyArray<[pattern: RegExp, kind: RouteSkeletonKind]> = [
  [/^\/dashboard\/admin\/students\/new$/u, "form-narrow"],
  [new RegExp(`^/dashboard/admin/students/${ID}/notes/new$`, "u"), "editor"],
  [new RegExp(`^/dashboard/admin/students/${ID}/notes$`, "u"), "record-list"],
  [/^\/dashboard\/admin\/notes$/u, "record-list"],
  [new RegExp(`^/dashboard/admin/students/${ID}(?:/.*)?$`, "u"), "student-detail"],
  [/^\/dashboard\/admin\/(?:operations|calendar-sync)$/u, "form"],
  [/^\/dashboard\/admin\/categories$/u, "form-wide"],
  [/^\/dashboard\/admin(?:\/.*)?$/u, "work-queue"],
  [new RegExp(`^/dashboard/student/assignments/(?:analysis/)?${ID}$`, "u"), "assignment"],
  [/^\/dashboard\/student\/digging$/u, "board"],
  [/^\/dashboard\/student\/notes\/new$/u, "editor"],
  [/^\/dashboard\/student\/notes$/u, "record-list"],
  [/^\/dashboard\/student(?:\/.*)?$/u, "today"],
  [/^\/dashboard\/notes\/trash$/u, "history"],
  [new RegExp(`^/dashboard/notes/${ID}/history$`, "u"), "history"],
  [new RegExp(`^/dashboard/notes/${ID}$`, "u"), "document"],
  [/^\/dashboard\/drafts$/u, "record-list-narrow"],
  [/^\/dashboard\/qna\/new$/u, "editor"],
  [/^\/dashboard\/qna\/trash$/u, "history"],
  [new RegExp(`^/dashboard/qna/${ID}/history$`, "u"), "history"],
  [new RegExp(`^/dashboard/qna/${ID}$`, "u"), "document"],
  [/^\/dashboard\/qna$/u, "thread-list"],
  [new RegExp(`^/dashboard/guide/${ID}/edit$`, "u"), "editor"],
  [new RegExp(`^/dashboard/guide/${ID}$`, "u"), "guide-page"],
  [/^\/dashboard\/guide$/u, "guide-index"],
  [/^\/community\/new$/u, "editor"],
  [/^\/community\/trash$/u, "history"],
  [new RegExp(`^/community/${ID}/history$`, "u"), "history"],
  [new RegExp(`^/community/${ID}$`, "u"), "document"],
  [/^\/community$/u, "thread-list"],
  [/^\/(?:login|invite|account\/password)$/u, "auth"],
  [/^\/privacy$/u, "privacy"],
];

export function resolveRouteSkeletonKind(pathname: string): RouteSkeletonKind {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/u, "") : pathname;
  for (const [pattern, kind] of ROUTE_SKELETON_RULES) {
    if (pattern.test(path)) return kind;
  }
  return "generic";
}
