/**
 * @file src/lib/instructor-memo.ts
 * @description 관리자 전용 수업 메모의 저장·이력 규칙. 학생과 함께 쓰는 노트와 다른 표에 두고,
 * 한 사람(Stann)이 쓰므로 공동 편집 대신 version 비교로 다른 기기의 덮어쓰기만 막는다.
 */
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { instructorMemoRevisions, instructorMemos } from "@/db/schema";

export const INSTRUCTOR_MEMO_MAX_HTML_LENGTH = 200_000;

export const INSTRUCTOR_MEMO_REVISION_RETENTION = {
  /** 이 시간 안의 저장은 마지막 이력 한 칸을 덮어쓴다. */
  coalesceSeconds: 10 * 60,
  /** 이보다 오래된 이력은 지운다(최신 한 칸은 남김). */
  retainSeconds: 90 * 24 * 60 * 60,
  /** 메모 하나에 남기는 이력 수의 상한. */
  maxCount: 200,
} as const;

export type InstructorMemoTarget = { studentId: string; noteId: string | null };

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
  return target.noteId === null
    ? and(eq(instructorMemos.studentId, target.studentId), isNull(instructorMemos.noteId))
    : and(eq(instructorMemos.studentId, target.studentId), eq(instructorMemos.noteId, target.noteId));
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

/** 저장된 내용을 이력에 남긴다. 10분 안에 이어진 저장은 마지막 칸을 덮어쓰고, 오래된 칸은 정리한다. */
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
  // 방금 만든 칸은 남기고, 보관 기간이 지났거나 상한을 넘은 칸을 지운다.
  await db
    .delete(instructorMemoRevisions)
    .where(
      and(
        eq(instructorMemoRevisions.memoId, input.memo.id),
        lt(instructorMemoRevisions.createdAt, new Date(nowMs - retention.retainSeconds * 1000)),
      ),
    );
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
