/**
 * 그룹레슨 규칙 중 화면과 서버가 함께 쓰는 값·타입·입력 정리(DB 없음). 클라이언트 컴포넌트는 이 파일만 불러온다.
 */

export const LESSON_GROUP_NAME_MAX = 60;
export const LESSON_GROUP_MIN_MEMBERS = 2;

export type LessonGroupSummary = { id: string; name: string; memberIds: string[] };

/** 학생에게 보이는 그룹: 이름과 멤버 표시 이름만(이메일 등은 넣지 않는다). */
export type StudentLessonGroup = {
  id: string;
  name: string;
  members: { id: string; name: string }[];
};

export type SaveLessonGroupError = "NAME" | "MEMBERS" | "NOT_STUDENT" | "TAKEN" | "NOT_FOUND" | "CONFLICT";
export type SaveLessonGroupResult =
  | { ok: true; id: string }
  | { ok: false; error: SaveLessonGroupError; takenStudentIds?: string[] };
export type DeleteLessonGroupResult =
  | { ok: true }
  | { ok: false; error: "NOT_FOUND" }
  | { ok: false; error: "HAS_NOTES"; noteCount: number };

export function normalizeLessonGroupName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= LESSON_GROUP_NAME_MAX ? name : null;
}

export function normalizeLessonGroupMemberIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const ids = [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200))];
  return ids.length === value.length && ids.length >= LESSON_GROUP_MIN_MEMBERS ? ids : null;
}

export function studentDisplayName(displayName: string | null): string {
  return displayName?.trim() || "이름 미등록";
}

/** 학생 홈에 보이는 그룹: 이름, 함께하는 학생 이름, 멤버 모두에게 같은 시각으로 있는 레슨 시작(epoch ms). */
export type StudentHomeLessonGroup = {
  name: string;
  partnerNames: string[];
  sharedLessonStarts: number[];
};

/**
 * 멤버마다 레슨 시작 시각 목록을 받아, 모든 멤버에게 같은 시각으로 있는 시각만 오름차순으로 돌려준다.
 * 그룹레슨은 "같은 그룹 + 같은 시작 시각"으로 묶는다(2026-11-15 사용자 결정). 멤버가 2명 미만이면 비어 있다.
 */
export function sharedLessonStarts(startsByMember: ReadonlyArray<ReadonlyArray<number>>): number[] {
  if (startsByMember.length < LESSON_GROUP_MIN_MEMBERS) return [];
  const [first, ...rest] = startsByMember.map((starts) => new Set(starts));
  return [...first].filter((start) => rest.every((starts) => starts.has(start))).sort((a, b) => a - b);
}
