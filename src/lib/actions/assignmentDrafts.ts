/**
 * 과제 글 계정 임시 저장(0035 `assignment_drafts`, 2026-11-23 사용자 결정 "계정에 저장해 다른 기기에서도 이어 쓰기").
 *
 * 경계
 * - 학생 세션만 쓴다. owner는 언제나 세션 학생이고 관리자는 읽지도 쓰지도 못한다(관리자는 제출한 글만 본다).
 * - key는 세 모양(`task-submission:<과제>`·`analysis:<과제>`·`free-submission:<제출|new>`)만 받는다.
 *   과제 key는 본인 과제, 자유 제출 key는 본인 자유 제출일 때만 쓴다. 이 확인은 INSERT 문 안에서 함께 한다.
 * - 저장은 version compare-and-set이다. 다른 기기가 먼저 바꿨거나 지웠으면 지금 사본을 돌려주고 덮어쓰지 않는다.
 * 헬퍼·타입은 `@/lib/assignment-drafts`와 `@/lib/assignment-draft-store`에 둔다("use server" 파일은 async export만).
 */
"use server";

import { and, eq, sql } from "drizzle-orm";
import { createDb } from "@/db/client";
import { assignmentDrafts } from "@/db/schema";
import { requireAuth } from "@/lib/auth-guard";
import {
  isValidAccountDraftPayload,
  parseAssignmentDraftKey,
  type AccountDraftCopy,
  type AssignmentDraftTarget,
  type DiscardAccountDraftResult,
  type GetAccountDraftResult,
  type SaveAccountDraftResult,
} from "@/lib/assignment-drafts";

async function studentOwnerId(): Promise<string | null> {
  const session = await requireAuth();
  return session.user.role === "student" && session.user.id ? session.user.id : null;
}

async function readCopy(db: ReturnType<typeof createDb>, ownerId: string, draftKey: string): Promise<AccountDraftCopy | null> {
  const [row] = await db
    .select({ payloadJson: assignmentDrafts.payloadJson, version: assignmentDrafts.version, updatedAt: assignmentDrafts.updatedAt })
    .from(assignmentDrafts)
    .where(and(eq(assignmentDrafts.ownerId, ownerId), eq(assignmentDrafts.draftKey, draftKey)))
    .limit(1);
  return row ?? null;
}

/** INSERT … SELECT의 WHERE: 이 key가 가리키는 과제·제출이 지금 학생 것인지. 새 자유 제출은 대상이 없다. */
function ownedTargetCondition(target: AssignmentDraftTarget, ownerId: string) {
  if (target.kind === "task") {
    return sql`EXISTS (SELECT 1 FROM assignment_tasks WHERE id = ${target.taskId} AND student_id = ${ownerId})`;
  }
  if (target.submissionId === null) return sql`1 = 1`;
  return sql`EXISTS (SELECT 1 FROM assignments WHERE id = ${target.submissionId} AND student_id = ${ownerId} AND task_id IS NULL)`;
}

/** 본인 계정 사본 하나. 없으면 draft: null, 학생이 아니거나 잘못된 key면 ok: false. */
export async function getMyAssignmentDraft(draftKey: string): Promise<GetAccountDraftResult> {
  const ownerId = await studentOwnerId();
  if (!ownerId || !parseAssignmentDraftKey(draftKey)) return { ok: false };
  return { ok: true, draft: await readCopy(createDb(), ownerId, draftKey) };
}

/**
 * 계정 사본을 쓴다. baseVersion이 null이면 새로 만들고(이미 있으면 conflict), 숫자면 그 version일 때만 바꾼다.
 * @param payloadJson 화면 값(JSON object), 200KB까지
 */
export async function saveMyAssignmentDraft(
  draftKey: string,
  payloadJson: string,
  baseVersion: number | null,
): Promise<SaveAccountDraftResult> {
  const ownerId = await studentOwnerId();
  const target = parseAssignmentDraftKey(draftKey);
  if (!ownerId || !target || !isValidAccountDraftPayload(payloadJson)) return { status: "denied" };
  if (baseVersion !== null && !(Number.isSafeInteger(baseVersion) && baseVersion >= 1)) return { status: "denied" };
  const db = createDb();
  const now = new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const taskId = target.kind === "task" ? target.taskId : null;

  if (baseVersion === null) {
    const inserted = await db.all<{ version: number }>(sql`
      INSERT INTO assignment_drafts (owner_id, draft_key, task_id, payload_json, version, updated_at)
      SELECT ${ownerId}, ${draftKey}, ${taskId}, ${payloadJson}, 1, ${nowSeconds}
      WHERE ${ownedTargetCondition(target, ownerId)}
      ON CONFLICT (owner_id, draft_key) DO NOTHING
      RETURNING version`);
    if (inserted.length > 0) return { status: "saved", version: 1, updatedAt: new Date(nowSeconds * 1000) };
    const current = await readCopy(db, ownerId, draftKey);
    return current ? { status: "conflict", draft: current } : { status: "denied" };
  }

  const updated = await db
    .update(assignmentDrafts)
    .set({ payloadJson, version: baseVersion + 1, updatedAt: now })
    .where(and(
      eq(assignmentDrafts.ownerId, ownerId),
      eq(assignmentDrafts.draftKey, draftKey),
      eq(assignmentDrafts.version, baseVersion),
    ))
    .returning({ version: assignmentDrafts.version, updatedAt: assignmentDrafts.updatedAt });
  if (updated[0]) return { status: "saved", version: updated[0].version, updatedAt: updated[0].updatedAt };
  return { status: "conflict", draft: await readCopy(db, ownerId, draftKey) };
}

/** 학생이 글을 처음 상태로 되돌렸을 때 계정 사본을 지운다. 그 사이 다른 기기가 고쳤으면(version 다름) 지우지 않는다. */
export async function discardMyAssignmentDraft(draftKey: string, baseVersion: number): Promise<DiscardAccountDraftResult> {
  const ownerId = await studentOwnerId();
  if (!ownerId || !parseAssignmentDraftKey(draftKey) || !Number.isSafeInteger(baseVersion)) return { status: "denied" };
  const db = createDb();
  const deleted = await db
    .delete(assignmentDrafts)
    .where(and(
      eq(assignmentDrafts.ownerId, ownerId),
      eq(assignmentDrafts.draftKey, draftKey),
      eq(assignmentDrafts.version, baseVersion),
    ))
    .returning({ version: assignmentDrafts.version });
  if (deleted.length > 0) return { status: "discarded" };
  const current = await readCopy(db, ownerId, draftKey);
  return current ? { status: "conflict", draft: current } : { status: "discarded" };
}
