import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import {
  DOCUMENT_SERVER_DRAFT_MAX_PAYLOAD_BYTES,
  DOCUMENT_SERVER_DRAFT_RETENTION_SECONDS,
  type DocumentServerDraftOperationType,
  type DocumentServerDraftResultState,
} from "@/lib/document-server-draft-constants";

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  email: text("email").unique().notNull(),
  passwordHash: text("password_hash"),
  displayName: text("display_name"),
  role: text("role").default("student").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),
});

export const curriculums = sqliteTable("curriculums", {
  id: text("id").primaryKey(),
  studentId: text("student_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  weekNum: integer("week_num").notNull(),
  title: text("title").notNull(),
  isCompleted: integer("is_completed", { mode: "boolean" })
    .default(false)
    .notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),
});

export const lessons = sqliteTable("lessons", {
  id: text("id").primaryKey(),
  studentId: text("student_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  scheduledAt: integer("scheduled_at", { mode: "timestamp" }).notNull(),
  googleEventId: text("google_event_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),
});

export const assignments = sqliteTable("assignments", {
  id: text("id").primaryKey(),
  studentId: text("student_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  mediaUrl: text("media_url").notNull(),
  submittedAt: integer("submitted_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),
});

export const feedbacks = sqliteTable("feedbacks", {
  id: text("id").primaryKey(),
  assignmentId: text("assignment_id")
    .references(() => assignments.id, { onDelete: "cascade" })
    .notNull(),
  timeMarker: integer("time_marker").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),
});

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  slug: text("slug").unique().notNull(),
  name: text("name").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),
});

export type DocumentResourceType = "PRIVATE_NOTE";
export type DocumentOperationType =
  | "CREATE"
  | "UPDATE"
  | "TRASH"
  | "RESTORE_TRASH"
  | "RESTORE_REVISION"
  | "PURGE";

/** 원문과 분리된 문서 mutation receipt. row는 schema trigger로 불변이다. */
export const documentOperationLedger = sqliteTable(
  "document_operation_ledger",
  {
    id: text("id").primaryKey(),
    operationId: text("operation_id").notNull(),
    actorId: text("actor_id").notNull(),
    subjectId: text("subject_id").notNull(),
    resourceType: text("resource_type").$type<DocumentResourceType>().notNull(),
    operationType: text("operation_type").$type<DocumentOperationType>().notNull(),
    resourceId: text("resource_id").notNull(),
    requestHash: text("request_hash").notNull(),
    requestHashVersion: integer("request_hash_version").notNull(),
    resultRevision: integer("result_revision").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("document_operation_ledger_actor_operation_unique").on(
      table.actorId,
      table.operationId,
    ),
    index("document_operation_ledger_resource_created_idx").on(
      table.resourceType,
      table.resourceId,
      table.createdAt,
    ),
    check(
      "document_operation_ledger_resource_type_check",
      sql`${table.resourceType} = 'PRIVATE_NOTE'`,
    ),
    check(
      "document_operation_ledger_operation_type_check",
      sql`${table.operationType} IN ('CREATE', 'UPDATE', 'TRASH', 'RESTORE_TRASH', 'RESTORE_REVISION', 'PURGE')`,
    ),
    check(
      "document_operation_ledger_nonempty_ids_check",
      sql`length(${table.operationId}) > 0 AND length(${table.actorId}) > 0 AND length(${table.subjectId}) > 0 AND length(${table.resourceId}) > 0`,
    ),
    check(
      "document_operation_ledger_request_hash_check",
      sql`length(${table.requestHash}) = 64 AND ${table.requestHashVersion} >= 1`,
    ),
    check(
      "document_operation_ledger_result_revision_check",
      sql`${table.resultRevision} >= 1`,
    ),
  ],
);

/** 본문 purge 뒤에도 과거 resource ID 재점유를 막는 최소 tombstone. */
export const documentTombstones = sqliteTable(
  "document_tombstones",
  {
    resourceType: text("resource_type").$type<DocumentResourceType>().notNull(),
    resourceId: text("resource_id").notNull(),
    subjectId: text("subject_id").notNull(),
    ownerId: text("owner_id").notNull(),
    sourceCreatedAt: integer("source_created_at", { mode: "timestamp" }),
    sourceVersion: integer("source_version").notNull(),
    purgedAt: integer("purged_at", { mode: "timestamp" }).notNull(),
    purgedById: text("purged_by_id"),
  },
  (table) => [
    primaryKey({ columns: [table.resourceType, table.resourceId] }),
    index("document_tombstones_subject_purged_idx").on(
      table.resourceType,
      table.subjectId,
      table.purgedAt,
    ),
    check(
      "document_tombstones_resource_type_check",
      sql`${table.resourceType} = 'PRIVATE_NOTE'`,
    ),
    check(
      "document_tombstones_nonempty_ids_check",
      sql`length(${table.resourceId}) > 0 AND length(${table.subjectId}) > 0 AND length(${table.ownerId}) > 0`,
    ),
    check(
      "document_tombstones_source_version_check",
      sql`${table.sourceVersion} >= 1`,
    ),
  ],
);

/** D1 batch에서 0-row conditional DML을 오류로 승격하는 fail-closed sentinel. */
export const documentBatchAbortGuard = sqliteTable(
  "document_batch_abort_guard",
  {
    reason: text("reason").notNull(),
  },
);

export type DocumentServerDraftKind =
  | "note"
  | "community-post"
  | "qna-thread"
  | "qna-reply";

/** 계정·문서 namespace별 최신 서버 초안. 계정 삭제 시 원문을 즉시 cascade한다. */
export const documentServerDrafts = sqliteTable(
  "document_server_drafts",
  {
    ownerId: text("owner_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    sourceKey: text("source_key").notNull(),
    documentKind: text("document_kind").$type<DocumentServerDraftKind>().notNull(),
    contextId: text("context_id").notNull(),
    payloadJson: text("payload_json").notNull(),
    payloadHash: text("payload_hash").notNull(),
    draftVersion: integer("draft_version").notNull(),
    baseResourceVersion: integer("base_resource_version"),
    writerDeviceId: text("writer_device_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.sourceKey] }),
    index("document_server_drafts_owner_updated_idx").on(
      table.ownerId,
      table.updatedAt,
    ),
    index("document_server_drafts_expires_idx").on(table.expiresAt),
    check(
      "document_server_drafts_kind_check",
      sql`${table.documentKind} IN ('note', 'community-post', 'qna-thread', 'qna-reply')`,
    ),
    check(
      "document_server_drafts_identity_check",
      sql`length(${table.ownerId}) > 0 AND length(${table.sourceKey}) > 0 AND length(${table.contextId}) > 0 AND length(${table.writerDeviceId}) > 0`,
    ),
    check(
      "document_server_drafts_payload_check",
      sql`json_valid(${table.payloadJson}) AND json_type(${table.payloadJson}) = 'object' AND length(CAST(${table.payloadJson} AS BLOB)) <= ${sql.raw(String(DOCUMENT_SERVER_DRAFT_MAX_PAYLOAD_BYTES))} AND length(${table.payloadHash}) = 64`,
    ),
    check(
      "document_server_drafts_version_check",
      sql`${table.draftVersion} >= 1 AND (${table.baseResourceVersion} IS NULL OR ${table.baseResourceVersion} >= 1)`,
    ),
    check(
      "document_server_drafts_timestamp_check",
      sql`${table.createdAt} <= ${table.updatedAt} AND ${table.expiresAt} = ${table.updatedAt} + ${sql.raw(String(DOCUMENT_SERVER_DRAFT_RETENTION_SECONDS))}`,
    ),
  ],
);

/** 재전송 판정을 위한 원문 없는 30일 server-draft operation receipt. */
export const documentServerDraftOperations = sqliteTable(
  "document_server_draft_operations",
  {
    ownerId: text("owner_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    operationId: text("operation_id").notNull(),
    sourceKey: text("source_key").notNull(),
    operationType: text("operation_type")
      .$type<DocumentServerDraftOperationType>()
      .notNull(),
    requestHash: text("request_hash").notNull(),
    requestHashVersion: integer("request_hash_version").notNull(),
    resultVersion: integer("result_version").notNull(),
    resultState: text("result_state")
      .$type<DocumentServerDraftResultState>()
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.operationId] }),
    index("document_server_draft_operations_source_created_idx").on(
      table.ownerId,
      table.sourceKey,
      table.createdAt,
    ),
    index("document_server_draft_operations_expires_idx").on(table.expiresAt),
    check(
      "document_server_draft_operations_type_check",
      sql`${table.operationType} IN ('UPSERT', 'DISCARD')`,
    ),
    check(
      "document_server_draft_operations_state_check",
      sql`${table.resultState} IN ('PRESENT', 'DISCARDED') AND ((${table.operationType} = 'UPSERT' AND ${table.resultState} = 'PRESENT' AND ${table.resultVersion} >= 1) OR (${table.operationType} = 'DISCARD' AND ${table.resultState} = 'DISCARDED' AND ${table.resultVersion} >= 0))`,
    ),
    check(
      "document_server_draft_operations_identity_check",
      sql`length(${table.ownerId}) > 0 AND length(${table.operationId}) > 0 AND length(${table.sourceKey}) > 0`,
    ),
    check(
      "document_server_draft_operations_hash_check",
      sql`length(${table.requestHash}) = 64 AND ${table.requestHashVersion} >= 1`,
    ),
    check(
      "document_server_draft_operations_timestamp_check",
      sql`${table.expiresAt} = ${table.createdAt} + ${sql.raw(String(DOCUMENT_SERVER_DRAFT_RETENTION_SECONDS))}`,
    ),
  ],
);

export const privateNotes = sqliteTable(
  "private_notes",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .references(() => profiles.id, { onDelete: "restrict" })
      .notNull(),
    authorId: text("author_id")
      .references(() => profiles.id, { onDelete: "restrict" })
      .notNull(),
    title: text("title").notNull(),
    contentHtml: text("content_html").notNull(),
    /** 사용자가 지정한 노트 날짜. 없으면 createdAt fallback. */
    noteDate: integer("note_date", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .default(sql`(strftime('%s', 'now'))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .default(sql`(strftime('%s', 'now'))`)
      .notNull(),
    version: integer("version").default(1).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
    deletedById: text("deleted_by_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("private_notes_student_deleted_created_idx").on(
      table.studentId,
      table.deletedAt,
      table.createdAt,
    ),
    index("private_notes_deleted_at_idx").on(table.deletedAt),
    check("private_notes_version_check", sql`${table.version} >= 1`),
    check(
      "private_notes_deleted_actor_check",
      sql`${table.deletedAt} IS NOT NULL OR ${table.deletedById} IS NULL`,
    ),
  ],
);

export type PrivateNoteRevisionChangeType =
  | "BASELINE"
  | "CREATE"
  | "UPDATE"
  | "RESTORE_REVISION"
  | "TRASH"
  | "RESTORE_TRASH";

/** private note의 append-only full snapshot history. */
export const privateNoteRevisions = sqliteTable(
  "private_note_revisions",
  {
    id: text("id").primaryKey(),
    noteId: text("note_id")
      .references(() => privateNotes.id, { onDelete: "cascade" })
      .notNull(),
    revisionNumber: integer("revision_number").notNull(),
    changeType: text("change_type").$type<PrivateNoteRevisionChangeType>().notNull(),
    title: text("title").notNull(),
    contentHtml: text("content_html").notNull(),
    noteDate: integer("note_date", { mode: "timestamp" }),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
    snapshotHash: text("snapshot_hash"),
    snapshotHashVersion: integer("snapshot_hash_version"),
    actorId: text("actor_id"),
    restoredFromRevision: integer("restored_from_revision"),
    operationRecordId: text("operation_record_id").references(
      () => documentOperationLedger.id,
      { onDelete: "restrict" },
    ),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("private_note_revisions_note_number_unique").on(
      table.noteId,
      table.revisionNumber,
    ),
    uniqueIndex("private_note_revisions_operation_unique").on(
      table.operationRecordId,
    ),
    index("private_note_revisions_note_created_idx").on(
      table.noteId,
      table.createdAt,
    ),
    check(
      "private_note_revisions_number_check",
      sql`${table.revisionNumber} >= 1`,
    ),
    check(
      "private_note_revisions_change_type_check",
      sql`${table.changeType} IN ('BASELINE', 'CREATE', 'UPDATE', 'RESTORE_REVISION', 'TRASH', 'RESTORE_TRASH')`,
    ),
    check(
      "private_note_revisions_identity_check",
      sql`(
        ${table.changeType} = 'BASELINE'
        AND ${table.revisionNumber} = 1
        AND ${table.actorId} IS NULL
        AND ${table.snapshotHash} IS NULL
        AND ${table.snapshotHashVersion} IS NULL
        AND ${table.operationRecordId} IS NULL
      ) OR (
        ${table.changeType} <> 'BASELINE'
        AND ${table.actorId} IS NOT NULL
        AND length(${table.actorId}) > 0
        AND ${table.snapshotHash} IS NOT NULL
        AND length(${table.snapshotHash}) = 64
        AND ${table.snapshotHashVersion} IS NOT NULL
        AND ${table.snapshotHashVersion} >= 1
        AND ${table.operationRecordId} IS NOT NULL
      )`,
    ),
    check(
      "private_note_revisions_initial_number_check",
      sql`(
        ${table.changeType} IN ('CREATE', 'BASELINE')
        AND ${table.revisionNumber} = 1
      ) OR (
        ${table.changeType} NOT IN ('CREATE', 'BASELINE')
        AND ${table.revisionNumber} > 1
      )`,
    ),
    check(
      "private_note_revisions_deleted_state_check",
      sql`(
        ${table.changeType} = 'TRASH'
        AND ${table.deletedAt} IS NOT NULL
      ) OR (
        ${table.changeType} <> 'TRASH'
        AND ${table.deletedAt} IS NULL
      )`,
    ),
    check(
      "private_note_revisions_restore_source_check",
      sql`(
        ${table.changeType} = 'RESTORE_REVISION'
        AND ${table.restoredFromRevision} IS NOT NULL
        AND ${table.restoredFromRevision} >= 1
      ) OR (
        ${table.changeType} <> 'RESTORE_REVISION'
        AND ${table.restoredFromRevision} IS NULL
      )`,
    ),
  ],
);

/**
 * Phase 3: boardType으로 게시판 유형 분리.
 * - ANNOUNCEMENT: 공지 (Admin 전용 작성, 아코디언 UI)
 * - GENERAL: 자유 게시판 (카테고리별 스레드)
 * - FEEDBACK: 믹스셋 공유 (R2 오디오 업로드 + 인라인 플레이어)
 * category 컬럼은 GENERAL 타입 하위 분류용으로 유지.
 */
export type BoardType = "ANNOUNCEMENT" | "GENERAL" | "FEEDBACK";

export const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),
  authorId: text("author_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  contentHtml: text("content_html").notNull(),
  // Phase 3 추가 컬럼
  boardType: text("board_type")
    .$type<BoardType>()
    .default("GENERAL")
    .notNull(),
  isPinned: integer("is_pinned", { mode: "boolean" }).default(false).notNull(),
  mediaUrl: text("media_url"), // FEEDBACK 타입 R2 오디오 URL
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),
});

export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  postId: text("post_id")
    .references(() => posts.id, { onDelete: "cascade" })
    .notNull(),
  authorId: text("author_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  contentHtml: text("content_html").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),
});

/**
 * Phase 5: 디깅 게시판 — 컬럼 정의 (유저별 커스텀).
 * columnType: text / textarea / number / select / rating / link / camelot_key
 * isDefault=true → 삭제 불가 (기본 제공 컬럼).
 * options: select 타입일 때 JSON 배열 (예: '["좋음","보통","별로"]')
 */
export type DiggingColumnType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "rating"
  | "link"
  | "camelot_key";

export const diggingColumns = sqliteTable("digging_columns", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  columnType: text("column_type")
    .$type<DiggingColumnType>()
    .default("text")
    .notNull(),
  options: text("options"), // JSON array — select 타입 전용
  sortOrder: integer("sort_order").default(0).notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).default(false).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),
});

/**
 * Phase 5: 디깅 게시판 — 트랙 데이터.
 * values: JSON 객체 { [columnId]: value } — 모든 컬럼 값 저장.
 * linkUrl: 음악 링크 (YouTube / SoundCloud / Spotify 등).
 */
export const diggingTracks = sqliteTable("digging_tracks", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  linkUrl: text("link_url"),
  values: text("values").default("{}").notNull(), // JSON
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),
});

/**
 * Phase 6: 1:1 Q&A 게시판.
 * - OPEN: 미답변
 * - ANSWERED: 답변 완료
 * - CLOSED: 종료
 */
export type QnaStatus = "OPEN" | "ANSWERED" | "CLOSED";

export const qnaThreads = sqliteTable("qna_threads", {
  id: text("id").primaryKey(),
  studentId: text("student_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  title: text("title").notNull(),
  status: text("status").$type<QnaStatus>().default("OPEN").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),
});

export const qnaReplies = sqliteTable("qna_replies", {
  id: text("id").primaryKey(),
  threadId: text("thread_id")
    .references(() => qnaThreads.id, { onDelete: "cascade" })
    .notNull(),
  authorId: text("author_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  contentHtml: text("content_html").notNull(),
  attachmentUrl: text("attachment_url"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),
});

/**
 * Phase 4: 개인 캘린더 이벤트.
 * - LESSON: 수업 일정 (파란색)
 * - PRACTICE: 연습 일정 (초록색)
 * - GIG: 공연/행사 (빨간색)
 * - NOTE: 메모/기타 (주황색)
 */
export type CalendarEventType = "LESSON" | "PRACTICE" | "GIG" | "NOTE";

export const calendarEvents = sqliteTable("calendar_events", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  eventType: text("event_type")
    .$type<CalendarEventType>()
    .default("NOTE")
    .notNull(),
  title: text("title").notNull(),
  startTime: integer("start_time", { mode: "timestamp" }).notNull(),
  endTime: integer("end_time", { mode: "timestamp" }),
  description: text("description"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),
});
