/**
 * 관리자의 학생 삭제 조건(2026-11-18 사용자 결정, 캔버스 StudentArchive 5번).
 * 가입 전(가입 링크만 있고 학생이 비밀번호를 정하지 않음)이면서 기록이 하나도 없고 그룹에 속하지 않은 수강 중 학생만
 * 지운다. 그 밖의 학생은 수강 종료(보관)한다. 판정 read와 삭제 batch의 guard가 같은 조건을 쓰도록 여기 한 군데에 둔다.
 * 표·칸 이름은 코드 상수만 쓴다(사용자 입력을 SQL에 넣지 않는다).
 */
import { sql } from "drizzle-orm";
import type { DbContext } from "@/db/client";
import { asDocumentReadDb } from "@/lib/document-lifecycle-atomic";
import { INVITE_HASH_PREFIX } from "@/lib/password-storage";
import { activeStudentSql } from "@/lib/student-status";

type ProfileReference = readonly [table: string, column: string];

/** 관리자가 만든 설정. 이것만 있으면 삭제할 수 있고, 삭제할 때 계정과 함께 지워진다. */
export const STUDENT_DELETION_CLEANUP_COLUMNS: readonly ProfileReference[] = [
  ["calendar_feed_tokens", "owner_id"],
  ["guide_access", "student_id"],
  ["guide_access_pages", "student_id"],
  ["push_subscriptions", "profile_id"],
  ["push_muted_categories", "profile_id"],
];

/** 그룹 자리. 있으면 그룹에서 뺀 뒤 삭제한다. */
export const STUDENT_DELETION_GROUP_COLUMN: ProfileReference = ["lesson_group_members", "student_id"];

/**
 * 하나라도 있으면 기록이 있는 학생이다. 학생 id를 담을 수 있는 칸 전부(작성자·처리자 칸, 지운 노트가 남기는
 * 이력·흔적, 캘린더 연결, 계정 삭제 영수증 포함). 새 표가 학생 id를 담으면 여기나 위 목록에 넣는다
 * (`student-deletion.test.ts`가 migration을 적용한 schema와 대조한다).
 */
export const STUDENT_DELETION_RECORD_COLUMNS: readonly ProfileReference[] = [
  ["lessons", "student_id"],
  ["curriculums", "student_id"],
  ["private_notes", "student_id"],
  ["private_notes", "author_id"],
  ["private_notes", "deleted_by_id"],
  ["private_note_revisions", "actor_id"],
  ["instructor_memos", "student_id"],
  ["instructor_memos", "updated_by_id"],
  ["assignments", "student_id"],
  ["assignment_tasks", "student_id"],
  ["assignment_tasks", "created_by_id"],
  ["assignment_recurrences", "student_id"],
  ["assignment_recurrences", "created_by_id"],
  ["calendar_events", "user_id"],
  ["external_calendar_subscriptions", "student_id"],
  ["calendar_mappings", "student_id"],
  ["calendar_connections", "owner_id"],
  ["digging_playlists", "user_id"],
  ["digging_feedbacks", "student_id"],
  ["digging_tracks", "user_id"],
  ["digging_columns", "user_id"],
  ["qna_threads", "student_id"],
  ["qna_threads", "deleted_by_id"],
  ["qna_replies", "author_id"],
  // 고친 답글 기록(0039). 고친 사람은 답글 작성자다.
  ["qna_reply_revisions", "editor_id"],
  ["qna_thread_events", "actor_id"],
  ["posts", "author_id"],
  ["posts", "deleted_by_id"],
  ["post_revisions", "actor_id"],
  ["comments", "author_id"],
  // 게시물 읽음(0034). 로그인한 학생만 남기므로 가입 전 학생에게는 생기지 않는다.
  ["post_reads", "student_id"],
  // 노트 열람(0044). 로그인한 학생만 남기므로 가입 전 학생에게는 생기지 않는다.
  ["note_views", "student_id"],
  // 과제 글 계정 임시 저장(0035). 로그인한 학생만 쓰므로 가입 전 학생에게는 생기지 않는다.
  ["assignment_drafts", "owner_id"],
  // 글 없이 보낸 알림의 받은 학생(0037). 보낼 때 가입한 학생만 넣으므로 가입 전 학생에게는 생기지 않는다.
  ["push_notice_recipients", "student_id"],
  ["push_notices", "author_id"],
  ["document_server_drafts", "owner_id"],
  ["document_server_draft_operations", "owner_id"],
  ["document_operation_ledger", "actor_id"],
  ["document_operation_ledger", "subject_id"],
  ["document_tombstones", "subject_id"],
  ["document_tombstones", "owner_id"],
  ["media_objects", "owner_id"],
  ["guide_pages", "created_by_id"],
  ["guide_pages", "updated_by_id"],
  // 가이드 휴지통·이력(0039). 관리자만 쓰지만 profiles를 가리키는 칸이라 기록으로 분류한다.
  ["guide_pages", "deleted_by_id"],
  ["guide_page_revisions", "actor_id"],
  ["guide_assets", "uploaded_by_id"],
  ["account_deletion_jobs", "subject_id"],
  ["account_cleanup_tokens", "subject_id"],
];

function referenceExistsSql([table, column]: ProfileReference, idExpression: string): string {
  return `EXISTS (SELECT 1 FROM ${table} AS blocker WHERE blocker.${column} = ${idExpression})`;
}

/**
 * 조건을 반씩 묶은 괄호 OR로 만든다. 한 줄로 이은 `a OR b OR c …`는 칸 수만큼 식 깊이가 늘어
 * D1의 식 깊이 한도(100)에 닿는다. 반씩 묶으면 깊이가 칸 수의 log₂로 준다.
 */
function balancedOrSql(conditions: readonly string[]): string {
  if (conditions.length === 1) return conditions[0];
  const middle = Math.ceil(conditions.length / 2);
  return `(${balancedOrSql(conditions.slice(0, middle))} OR ${balancedOrSql(conditions.slice(middle))})`;
}

function anyRecordSql(idExpression: string): string {
  return balancedOrSql(STUDENT_DELETION_RECORD_COLUMNS.map((reference) => referenceExistsSql(reference, idExpression)));
}

/** profiles 별칭이 가입 전인지(가입 링크 hash). 임시 비밀번호·일반 비밀번호는 가입한 것으로 본다. */
function inviteOnlySql(alias: string): string {
  return `substr(${alias}.password_hash, 1, ${INVITE_HASH_PREFIX.length}) = '${INVITE_HASH_PREFIX}'`;
}

/** 직접 쓴 SQL에서 profiles 별칭이 지금 삭제할 수 있는 학생인지. 별칭은 코드 상수만 넘긴다. */
export function deletableStudentSql(alias: string): string {
  return [
    activeStudentSql(alias),
    inviteOnlySql(alias),
    `NOT ${referenceExistsSql(STUDENT_DELETION_GROUP_COLUMN, `${alias}.id`)}`,
    `NOT (${anyRecordSql(`${alias}.id`)})`,
  ].join(" AND ");
}

/**
 * 학생 상세 계정 구역이 보여 줄 삭제 상태.
 * - deletable: '학생 삭제' 버튼
 * - has-records / in-group: 버튼 대신 이유 안내(가입 전 학생만)
 * - signed-up: 가입한 학생(임시 비밀번호 포함). 안내 없이 수강 종료만
 */
export type StudentDeletionState =
  | { kind: "deletable" }
  | { kind: "has-records" }
  | { kind: "in-group"; groupName: string }
  | { kind: "signed-up" };

/** 수강 중인 학생의 삭제 상태. 학생이 아니거나 수강 종료한 계정이면 null. */
export async function readStudentDeletionState(
  context: DbContext,
  studentId: string,
): Promise<StudentDeletionState | null> {
  const rows = await asDocumentReadDb(context).all<{
    inviteOnly: number;
    hasRecords: number;
    groupName: string | null;
  }>(sql`
    SELECT
      CASE WHEN ${sql.raw(inviteOnlySql("profile"))} THEN 1 ELSE 0 END AS inviteOnly,
      CASE WHEN ${sql.raw(anyRecordSql("profile.id"))} THEN 1 ELSE 0 END AS hasRecords,
      (
        SELECT lesson_group.name
        FROM lesson_group_members AS membership
        JOIN lesson_groups AS lesson_group ON lesson_group.id = membership.group_id
        WHERE membership.student_id = profile.id
        ORDER BY lesson_group.name
        LIMIT 1
      ) AS groupName
    FROM profiles AS profile
    WHERE profile.id = ${studentId} AND ${sql.raw(activeStudentSql("profile"))}
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  if (!row.inviteOnly) return { kind: "signed-up" };
  if (row.hasRecords) return { kind: "has-records" };
  if (row.groupName !== null) return { kind: "in-group", groupName: row.groupName };
  return { kind: "deletable" };
}
