import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

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

export const privateNotes = sqliteTable("private_notes", {
  id: text("id").primaryKey(),
  studentId: text("student_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  authorId: text("author_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  title: text("title").notNull(),
  contentHtml: text("content_html").notNull(),
  /** 사용자가 지정한 노트 날짜. 없으면 createdAt fallback. */
  noteDate: integer("note_date", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(strftime('%s', 'now'))`,
  ),
});

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
