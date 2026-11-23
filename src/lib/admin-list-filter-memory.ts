/**
 * 관리자 전체 노트·과제 목록의 마지막 학생 필터 기억. 사이드바로 다시 오면(주소에 `?student=`가 없으면) 마지막에 고른
 * 학생으로 연다. 학생 필터가 고를 때와 그려질 때 cookie를 쓰고, 서버 page가 주소에 값이 없을 때만 읽는다.
 * 값은 학생 id(또는 "전체 학생"이면 빈 값)뿐이고, 서버가 수강 중인 학생 목록과 다시 맞춰 보므로 모르는 값은 전체로 돌아간다.
 */
export const ADMIN_LIST_FILTER_COOKIES = {
  notes: "portal-admin-notes-student",
  assignments: "portal-admin-assignments-student",
} as const;

export type AdminListFilterKey = keyof typeof ADMIN_LIST_FILTER_COOKIES;

const MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

/** `document.cookie`에 그대로 쓰는 문자열. 빈 값("전체 학생")도 기억한다. */
export function serializeAdminListFilterCookie(key: AdminListFilterKey, studentId: string | null, secure: boolean): string {
  const value = studentId && ID_PATTERN.test(studentId) ? studentId : "";
  return `${ADMIN_LIST_FILTER_COOKIES[key]}=${value}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/**
 * 주소의 `?student=` 값이 없을 때만 cookie 값을 쓴다. 주소에 값이 있으면(빈 값 포함) 그 값을 따른다.
 */
export function resolveRememberedStudent(fromUrl: string | null | undefined, fromCookie: string | undefined): string | null {
  if (fromUrl !== null && fromUrl !== undefined) return fromUrl || null;
  return fromCookie && ID_PATTERN.test(fromCookie) ? fromCookie : null;
}
