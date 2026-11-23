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

/**
 * 학생 한 명 화면의 레슨 예약·추가에서 "그룹 전체"를 고르면 보내는 칸(값 "1"). 그룹은 서버가 그 학생의 소속으로 정하고
 * 멤버마다 같은 시각 레슨을 하나씩 만든다(캔버스 UxReview1120Lessons ⑥).
 */
export const LESSON_WITH_GROUP_FIELD = "withGroup";

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

/** 받침이 있으면 "과", 없으면(또는 한글이 아니면) "와". */
function withAndParticle(name: string): string {
  const last = name.trim().at(-1) ?? "";
  const code = last.charCodeAt(0);
  const hasFinal = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
  return `${name}${hasFinal ? "과" : "와"}`;
}

/** 그룹 이름 표시: 이름이 이미 "그룹"으로 끝나면("화요 그룹") 다시 붙이지 않는다("화요 그룹 그룹" 방지). */
export function formatGroupLabel(name: string): string {
  const trimmed = name.trim();
  return /그룹$/.test(trimmed) ? trimmed : `${trimmed} 그룹`;
}

/**
 * 그룹 노트 문서 머리 안내 줄(승인 캔버스 문구): "{그룹} 그룹 노트 · 이학생과 Stann도 보고 함께 고칠 수 있어요."
 * 보는 사람이 멤버면 다른 멤버와 Stann을, 관리자면 멤버 모두를 적는다.
 */
export function groupNoteShareLine(
  group: { name: string; members: { id: string; name: string }[] },
  viewer: { id: string; isAdmin: boolean },
  options: { studentReadOnly?: boolean } = {},
): string {
  const head = `${formatGroupLabel(group.name)} 노트`;
  // 관리자가 학생 편집을 막은 노트(0036): 멤버는 읽기만 한다.
  if (options.studentReadOnly) {
    if (!viewer.isAdmin) return `${head} · Stann이 읽기 전용으로 두었어요.`;
    const names = group.members.map((member) => member.name).join("·");
    return names ? `${head} · 읽기 전용 · ${names}에게는 보기만 열려 있어요.` : `${head} · 읽기 전용 · 그룹 멤버는 보기만 해요.`;
  }
  if (viewer.isAdmin) {
    const names = group.members.map((member) => member.name).join("·");
    return names ? `${head} · ${names}도 보고 함께 고칠 수 있어요.` : `${head} · 그룹 멤버도 보고 함께 고칠 수 있어요.`;
  }
  const others = group.members.filter((member) => member.id !== viewer.id).map((member) => member.name);
  return others.length
    ? `${head} · ${withAndParticle(others.join("·"))} Stann도 보고 함께 고칠 수 있어요.`
    : `${head} · Stann도 보고 함께 고칠 수 있어요.`;
}
