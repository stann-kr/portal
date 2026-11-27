/**
 * @file src/lib/actions/instructorMemos.ts
 * @description 관리자만 보는 수업 메모(학생별·노트별·학생 날짜별) server action. 모든 호출이 관리자 세션을 요구하고,
 * 노트 메모는 대상 학생을 클라이언트 입력이 아니라 노트에서 읽는다. 개인 노트와 그룹 노트 모두 노트 메모를 쓴다.
 */
"use server";

import { and, asc, eq, gte, isNull, lt } from "drizzle-orm";
import { createDb } from "@/db/client";
import { lessons, privateNotes } from "@/db/schema";
import { listActiveStudentProfiles } from "@/lib/active-profile";
import { requireAdmin, requireStudentTarget } from "@/lib/auth-guard";
import { dayNumberFromKey, kstTodayKey } from "@/lib/assignment-recurrence";
import {
  INSTRUCTOR_MEMO_MAX_HTML_LENGTH,
  listDatedInstructorMemos,
  listDatedInstructorMemosForStudents,
  listInstructorMemoRevisions,
  readInstructorMemo,
  saveInstructorMemo,
  type InstructorMemoHead,
  type InstructorMemoTarget,
} from "@/lib/instructor-memo";
import { isRichTextEmpty } from "@/lib/rich-text";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { getUnifiedItemSpaceLabel } from "@/lib/unified-item-normalization";

/** 클라이언트가 고르는 메모 대상. 노트 메모의 학생은 서버가 노트에서 정한다. */
export type InstructorMemoScope =
  | { kind: "student"; studentId: string }
  | { kind: "note"; noteId: string }
  /** 노트 없이 남기는 그 날짜(KST YYYY-MM-DD)의 학생 메모. 진도 체크·다음 수업 참고용(2026-11-27 사용자 요청). */
  | { kind: "date"; studentId: string; date: string };

export type InstructorMemoSnapshot = {
  memoId: string | null;
  contentHtml: string;
  /** 0이면 아직 저장한 적 없는 메모 */
  version: number;
  updatedAt: Date | null;
};

export type SaveInstructorMemoState =
  | { ok: true; memo: InstructorMemoSnapshot }
  | { ok: false; error: string; conflict?: InstructorMemoSnapshot };

function toSnapshot(memo: InstructorMemoHead | null): InstructorMemoSnapshot {
  return memo
    ? { memoId: memo.id, contentHtml: memo.contentHtml, version: memo.version, updatedAt: memo.updatedAt }
    : { memoId: null, contentHtml: "", version: 0, updatedAt: null };
}

async function resolveTarget(scope: InstructorMemoScope): Promise<InstructorMemoTarget | null> {
  if (scope.kind === "student") {
    await requireStudentTarget(scope.studentId);
    return { studentId: scope.studentId, noteId: null };
  }
  if (scope.kind === "date") {
    await requireStudentTarget(scope.studentId);
    if (typeof scope.date !== "string" || dayNumberFromKey(scope.date) === null) return null;
    return { studentId: scope.studentId, noteId: null, memoDate: scope.date };
  }
  await requireAdmin();
  const db = createDb();
  const [note] = await db
    .select({ studentId: privateNotes.studentId, groupId: privateNotes.groupId })
    .from(privateNotes)
    .where(and(eq(privateNotes.id, scope.noteId), isNull(privateNotes.deletedAt)))
    .limit(1);
  if (!note) return null;
  // 그룹 노트의 이 수업 메모(캔버스 UxReview1120Policies ⑪)도 노트의 student_id에 붙인다. 그 학생이 수강을 종료했거나
  // 그룹을 떠나도 노트와 메모는 그룹 것이라 학생 상태를 묻지 않는다. 노트와 메모는 계정 삭제·영구 삭제 때 함께 지워진다.
  if (!note.groupId) await requireStudentTarget(note.studentId);
  return { studentId: note.studentId, noteId: scope.noteId };
}

export async function getInstructorMemo(scope: InstructorMemoScope): Promise<InstructorMemoSnapshot | null> {
  await requireAdmin();
  const target = await resolveTarget(scope);
  if (!target) return null;
  return toSnapshot(await readInstructorMemo(createDb(), target));
}

export async function saveInstructorMemoAction(
  scope: InstructorMemoScope,
  input: { contentHtml: string; baseVersion: number },
): Promise<SaveInstructorMemoState> {
  const session = await requireAdmin();
  if (!Number.isInteger(input.baseVersion) || input.baseVersion < 0) {
    return { ok: false, error: "저장 기준을 확인할 수 없습니다. 새로고침한 뒤 다시 시도해 주세요." };
  }
  const target = await resolveTarget(scope);
  if (!target) {
    return { ok: false, error: scope.kind === "date" ? "메모 날짜를 확인해 주세요." : "메모를 붙일 노트를 찾을 수 없습니다." };
  }
  const raw = typeof input.contentHtml === "string" ? input.contentHtml : "";
  const contentHtml = isRichTextEmpty(raw) ? "" : sanitizeHtml(raw);
  if (contentHtml.length > INSTRUCTOR_MEMO_MAX_HTML_LENGTH) {
    return { ok: false, error: "메모가 너무 깁니다. 일부를 나눠 적어 주세요." };
  }
  const db = createDb();
  // 처음 쓰는 메모를 비운 채 저장하지 않는다.
  if (input.baseVersion === 0 && contentHtml === "") {
    return { ok: true, memo: toSnapshot(null) };
  }
  const result = await saveInstructorMemo(db, {
    ...target,
    contentHtml,
    baseVersion: input.baseVersion,
    actorId: session.user.id!,
    now: new Date(),
  });
  if (!result.ok) {
    return {
      ok: false,
      error: "다른 기기에서 먼저 저장한 메모가 있습니다.",
      conflict: toSnapshot(result.current),
    };
  }
  return { ok: true, memo: toSnapshot(result.memo) };
}

export type InstructorMemoRevisionItem = {
  id: string;
  contentHtml: string;
  savedAt: Date;
};

export async function getInstructorMemoRevisions(scope: InstructorMemoScope): Promise<InstructorMemoRevisionItem[]> {
  await requireAdmin();
  const target = await resolveTarget(scope);
  if (!target) return [];
  const db = createDb();
  const memo = await readInstructorMemo(db, target);
  if (!memo) return [];
  const revisions = await listInstructorMemoRevisions(db, memo.id);
  return revisions.map((revision) => ({
    id: revision.id,
    contentHtml: revision.contentHtml,
    savedAt: revision.updatedAt,
  }));
}

export type DatedInstructorMemoItem = {
  date: string;
  contentHtml: string;
  updatedAt: Date;
};

/** 학생의 날짜 메모 목록(최근 날짜부터, 비운 날짜 제외). 관리자만, 대상 학생을 확인한 뒤 읽는다. */
export async function getDatedInstructorMemos(studentId: string): Promise<DatedInstructorMemoItem[]> {
  await requireStudentTarget(studentId);
  const memos = await listDatedInstructorMemos(createDb(), studentId);
  return memos.map((memo) => ({ date: memo.memoDate, contentHtml: memo.contentHtml, updatedAt: memo.updatedAt }));
}

export type AdminMemoBoardStudent = {
  id: string;
  label: string;
  /** 고른 날짜의 레슨 시작(첫 레슨). 없으면 null. */
  lessonAt: Date | null;
  /** 고른 날짜에 메모가 있는지. */
  hasMemo: boolean;
};

export type AdminMemoBoardEntry = DatedInstructorMemoItem & { studentId: string };

export type AdminMemoBoard = {
  date: string;
  today: string;
  /** 그날 레슨 학생(시간 순) 먼저, 나머지는 이름 순. */
  students: AdminMemoBoardStudent[];
  selectedStudentId: string | null;
  /** 고른 학생의 그 날짜 메모. 학생을 고르지 않았으면 null. */
  memo: InstructorMemoSnapshot | null;
  /** 그 날짜에 남긴 모든 학생의 메모. */
  dayEntries: AdminMemoBoardEntry[];
  /** 학생 상관없이 최근 날짜부터. */
  recentEntries: AdminMemoBoardEntry[];
};

const KST_DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_MEMO_LIMIT = 30;

/**
 * 관리자 "메모" 화면(사이드바, 2026-11-27 사용자 요청 "날짜별 학생 메모 접근이 너무 깊다").
 * 날짜를 먼저 고르고 그날 레슨 학생부터 보인다. 학생은 수강 중인 학생 목록에 있을 때만 고른다.
 * 레슨은 DB(lessons)만 본다. 바깥 캘린더 구독은 느릴 수 있어 이 화면을 막지 않는다.
 */
export async function getAdminMemoBoard(
  input: { date?: string | null; studentId?: string | null; now: Date },
): Promise<AdminMemoBoard> {
  await requireAdmin();
  const db = createDb();
  const today = kstTodayKey(input.now);
  const date = input.date && dayNumberFromKey(input.date) !== null ? input.date : today;
  const profiles = await listActiveStudentProfiles(db);
  const ids = profiles.map((profile) => profile.id);
  const dayStart = new Date(Date.parse(`${date}T00:00:00+09:00`));
  const dayEnd = new Date(dayStart.getTime() + KST_DAY_MS);
  const [lessonRows, dayMemos, recentMemos] = await Promise.all([
    ids.length === 0
      ? Promise.resolve([])
      : db
        .select({ studentId: lessons.studentId, scheduledAt: lessons.scheduledAt })
        .from(lessons)
        .where(and(gte(lessons.scheduledAt, dayStart), lt(lessons.scheduledAt, dayEnd)))
        .orderBy(asc(lessons.scheduledAt)),
    listDatedInstructorMemosForStudents(db, ids, { date }),
    listDatedInstructorMemosForStudents(db, ids, { limit: RECENT_MEMO_LIMIT }),
  ]);
  const lessonAt = new Map<string, Date>();
  for (const row of lessonRows) if (!lessonAt.has(row.studentId)) lessonAt.set(row.studentId, row.scheduledAt);
  const memoStudents = new Set(dayMemos.map((memo) => memo.studentId));
  const students = profiles
    .map((profile) => ({
      id: profile.id,
      label: getUnifiedItemSpaceLabel(profile),
      lessonAt: lessonAt.get(profile.id) ?? null,
      hasMemo: memoStudents.has(profile.id),
    }))
    .sort((a, b) => {
      if (a.lessonAt && b.lessonAt) return a.lessonAt.getTime() - b.lessonAt.getTime();
      if (a.lessonAt || b.lessonAt) return a.lessonAt ? -1 : 1;
      return a.label.localeCompare(b.label, "ko");
    });
  const selectedStudentId = input.studentId && ids.includes(input.studentId) ? input.studentId : null;
  const memo = selectedStudentId
    ? toSnapshot(await readInstructorMemo(db, { studentId: selectedStudentId, noteId: null, memoDate: date }))
    : null;
  const entry = (row: { studentId: string; memoDate: string; contentHtml: string; updatedAt: Date }): AdminMemoBoardEntry => ({
    studentId: row.studentId,
    date: row.memoDate,
    contentHtml: row.contentHtml,
    updatedAt: row.updatedAt,
  });
  return {
    date,
    today,
    students,
    selectedStudentId,
    memo,
    dayEntries: dayMemos.map(entry),
    recentEntries: recentMemos.map(entry),
  };
}
