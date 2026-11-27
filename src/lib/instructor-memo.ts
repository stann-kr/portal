/**
 * @file src/lib/instructor-memo.ts
 * @description 관리자 전용 수업 메모의 저장·이력 규칙. 학생과 함께 쓰는 노트와 다른 표에 두고,
 * 한 사람(Stann)이 쓰므로 공동 편집 대신 version 비교로 다른 기기의 덮어쓰기만 막는다.
 */
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { instructorMemoRevisions, instructorMemos } from "@/db/schema";

export const INSTRUCTOR_MEMO_MAX_HTML_LENGTH = 200_000;

export const INSTRUCTOR_MEMO_REVISION_RETENTION = {
  /** 이 시간 안의 저장은 마지막 이력 한 칸을 덮어쓴다. */
  coalesceSeconds: 10 * 60,
  /** 이보다 오래된 이력은 지운다(최신 칸과 그 바로 앞 칸은 남김). */
  retainSeconds: 90 * 24 * 60 * 60,
  /** 메모 하나에 남기는 이력 수의 상한. */
  maxCount: 200,
} as const;

/** 정리할 때 기간과 관계없이 남기는 최신 칸 수: 지금 내용과 그 바로 앞 내용. */
const INSTRUCTOR_MEMO_REVISION_ALWAYS_KEPT = 2;

/**
 * 메모 대상. noteId가 있으면 노트 메모, memoDate가 있으면 그 날짜의 학생 메모(0043), 둘 다 없으면 학생 메모다.
 * noteId와 memoDate를 함께 두지 않는다(DB CHECK).
 */
export type InstructorMemoTarget = { studentId: string; noteId: string | null; memoDate?: string | null };

export type InstructorMemoHead = {
  id: string;
  contentHtml: string;
  version: number;
  updatedAt: Date;
};

export type SaveInstructorMemoResult =
  | { ok: true; memo: InstructorMemoHead }
  | { ok: false; reason: "VERSION_CONFLICT"; current: InstructorMemoHead | null };

function targetCondition(target: InstructorMemoTarget) {
  if (target.noteId !== null) {
    return and(eq(instructorMemos.studentId, target.studentId), eq(instructorMemos.noteId, target.noteId));
  }
  return target.memoDate
    ? and(eq(instructorMemos.studentId, target.studentId), isNull(instructorMemos.noteId), eq(instructorMemos.memoDate, target.memoDate))
    : and(eq(instructorMemos.studentId, target.studentId), isNull(instructorMemos.noteId), isNull(instructorMemos.memoDate));
}

export async function readInstructorMemo(
  db: DrizzleDb,
  target: InstructorMemoTarget,
): Promise<InstructorMemoHead | null> {
  const [row] = await db
    .select({
      id: instructorMemos.id,
      contentHtml: instructorMemos.contentHtml,
      version: instructorMemos.version,
      updatedAt: instructorMemos.updatedAt,
    })
    .from(instructorMemos)
    .where(targetCondition(target))
    .limit(1);
  return row ?? null;
}

/**
 * 메모를 저장한다. `baseVersion` 0은 아직 없는 메모를 만든다는 뜻이다.
 * 다른 기기가 먼저 저장했으면 덮어쓰지 않고 지금 내용을 돌려준다.
 */
export async function saveInstructorMemo(
  db: DrizzleDb,
  input: InstructorMemoTarget & {
    contentHtml: string;
    baseVersion: number;
    actorId: string;
    now: Date;
  },
): Promise<SaveInstructorMemoResult> {
  const conflict = async (): Promise<SaveInstructorMemoResult> => ({
    ok: false,
    reason: "VERSION_CONFLICT",
    current: await readInstructorMemo(db, input),
  });

  let memo: InstructorMemoHead | undefined;
  if (input.baseVersion === 0) {
    const inserted = await db
      .insert(instructorMemos)
      .values({
        id: crypto.randomUUID(),
        studentId: input.studentId,
        noteId: input.noteId,
        memoDate: input.noteId === null ? input.memoDate ?? null : null,
        contentHtml: input.contentHtml,
        version: 1,
        updatedById: input.actorId,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning({
        id: instructorMemos.id,
        contentHtml: instructorMemos.contentHtml,
        version: instructorMemos.version,
        updatedAt: instructorMemos.updatedAt,
      });
    memo = inserted[0];
  } else {
    const updated = await db
      .update(instructorMemos)
      .set({
        contentHtml: input.contentHtml,
        version: sql`${instructorMemos.version} + 1`,
        updatedById: input.actorId,
        updatedAt: input.now,
      })
      .where(and(targetCondition(input), eq(instructorMemos.version, input.baseVersion)))
      .returning({
        id: instructorMemos.id,
        contentHtml: instructorMemos.contentHtml,
        version: instructorMemos.version,
        updatedAt: instructorMemos.updatedAt,
      });
    memo = updated[0];
  }
  if (!memo) return conflict();

  await recordInstructorMemoRevision(db, { memo, now: input.now });
  return { ok: true, memo };
}

/** 저장된 내용을 이력에 남긴다. 10분 안에 이어진 저장은 마지막 칸을 덮어쓰고, 오래된 칸은 정리한다(바로 앞 칸은 남김). */
async function recordInstructorMemoRevision(
  db: DrizzleDb,
  input: { memo: InstructorMemoHead; now: Date },
): Promise<void> {
  const retention = INSTRUCTOR_MEMO_REVISION_RETENTION;
  const nowMs = input.now.getTime();
  const [latest] = await db
    .select({ id: instructorMemoRevisions.id, createdAt: instructorMemoRevisions.createdAt })
    .from(instructorMemoRevisions)
    .where(eq(instructorMemoRevisions.memoId, input.memo.id))
    .orderBy(desc(instructorMemoRevisions.createdAt), desc(instructorMemoRevisions.revisionNumber))
    .limit(1);
  if (latest && nowMs - latest.createdAt.getTime() < retention.coalesceSeconds * 1000) {
    await db
      .update(instructorMemoRevisions)
      .set({
        revisionNumber: input.memo.version,
        contentHtml: input.memo.contentHtml,
        updatedAt: input.now,
      })
      .where(eq(instructorMemoRevisions.id, latest.id));
    return;
  }
  const revisionId = crypto.randomUUID();
  await db.insert(instructorMemoRevisions).values({
    id: revisionId,
    memoId: input.memo.id,
    revisionNumber: input.memo.version,
    contentHtml: input.memo.contentHtml,
    createdAt: input.now,
    updatedAt: input.now,
  });
  // 보관 기간이 지났거나 상한을 넘은 칸을 지운다. 방금 만든 칸과 그 바로 앞 칸(덮어쓰기 전 내용)은
  // 나이와 관계없이 남겨, 오래 둔 메모를 실수로 덮어도 되살릴 수 있게 한다.
  const cutoffSeconds = Math.floor((nowMs - retention.retainSeconds * 1000) / 1000);
  await db.run(sql`DELETE FROM instructor_memo_revisions
    WHERE memo_id = ${input.memo.id}
      AND created_at < ${cutoffSeconds}
      AND id NOT IN (
        SELECT kept.id FROM instructor_memo_revisions AS kept
        WHERE kept.memo_id = ${input.memo.id}
        ORDER BY kept.created_at DESC, kept.revision_number DESC
        LIMIT ${INSTRUCTOR_MEMO_REVISION_ALWAYS_KEPT}
      )`);
  await db.run(sql`DELETE FROM instructor_memo_revisions
    WHERE memo_id = ${input.memo.id}
      AND id NOT IN (
        SELECT kept.id FROM instructor_memo_revisions AS kept
        WHERE kept.memo_id = ${input.memo.id}
        ORDER BY kept.created_at DESC, kept.revision_number DESC
        LIMIT ${retention.maxCount}
      )`);
}

export type InstructorMemoRevision = {
  id: string;
  revisionNumber: number;
  contentHtml: string;
  createdAt: Date;
  updatedAt: Date;
};

export async function listInstructorMemoRevisions(
  db: DrizzleDb,
  memoId: string,
): Promise<InstructorMemoRevision[]> {
  return db
    .select({
      id: instructorMemoRevisions.id,
      revisionNumber: instructorMemoRevisions.revisionNumber,
      contentHtml: instructorMemoRevisions.contentHtml,
      createdAt: instructorMemoRevisions.createdAt,
      updatedAt: instructorMemoRevisions.updatedAt,
    })
    .from(instructorMemoRevisions)
    .where(eq(instructorMemoRevisions.memoId, memoId))
    .orderBy(desc(instructorMemoRevisions.createdAt), desc(instructorMemoRevisions.revisionNumber));
}

export type DatedInstructorMemo = {
  memoDate: string;
  contentHtml: string;
  updatedAt: Date;
};

/** 날짜 메모 목록(최근 날짜부터). 비워 저장한 날짜는 빼고, 한 번에 최근 `limit`개만 읽는다. */
export async function listDatedInstructorMemos(
  db: DrizzleDb,
  studentId: string,
  limit = 120,
): Promise<DatedInstructorMemo[]> {
  const rows = await db
    .select({
      memoDate: instructorMemos.memoDate,
      contentHtml: instructorMemos.contentHtml,
      updatedAt: instructorMemos.updatedAt,
    })
    .from(instructorMemos)
    .where(and(
      eq(instructorMemos.studentId, studentId),
      isNotNull(instructorMemos.memoDate),
      sql`${instructorMemos.contentHtml} <> ''`,
    ))
    .orderBy(desc(instructorMemos.memoDate))
    .limit(limit);
  return rows.flatMap((row) => (row.memoDate ? [{ memoDate: row.memoDate, contentHtml: row.contentHtml, updatedAt: row.updatedAt }] : []));
}

export type StudentDatedInstructorMemo = DatedInstructorMemo & { studentId: string };

/**
 * 여러 학생의 날짜 메모(관리자 "메모" 화면). `date`가 있으면 그 날짜 메모만, 없으면 최근 날짜부터 `limit`개.
 * 비워 저장한 날짜는 뺀다. 학생 목록은 호출하는 쪽이 수강 중인 학생으로 정한다.
 */
export async function listDatedInstructorMemosForStudents(
  db: DrizzleDb,
  studentIds: readonly string[],
  options: { date?: string; limit?: number } = {},
): Promise<StudentDatedInstructorMemo[]> {
  if (studentIds.length === 0) return [];
  const rows = await db
    .select({
      studentId: instructorMemos.studentId,
      memoDate: instructorMemos.memoDate,
      contentHtml: instructorMemos.contentHtml,
      updatedAt: instructorMemos.updatedAt,
    })
    .from(instructorMemos)
    .where(and(
      inArray(instructorMemos.studentId, [...studentIds]),
      options.date ? eq(instructorMemos.memoDate, options.date) : isNotNull(instructorMemos.memoDate),
      sql`${instructorMemos.contentHtml} <> ''`,
    ))
    .orderBy(desc(instructorMemos.memoDate), desc(instructorMemos.updatedAt))
    .limit(options.limit ?? 200);
  return rows.flatMap((row) => (row.memoDate
    ? [{ studentId: row.studentId, memoDate: row.memoDate, contentHtml: row.contentHtml, updatedAt: row.updatedAt }]
    : []));
}
