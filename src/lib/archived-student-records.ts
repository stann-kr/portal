/**
 * 수강 종료한 학생의 보기 전용 기록(캔버스 UxReview1120Policies ⑩, 2026-11-20 사용자 결정).
 * 관리자만, 그리고 수강 종료(ARCHIVED)한 학생만 읽는다. 수강 중인 학생은 원래 학생 상세에서 본다.
 * 쓰기 action은 두지 않는다(복원은 기존 restoreStudent). 서버 컴포넌트에서만 부르는 일반 모듈이라
 * client에서 부를 수 있는 server action으로 열지 않는다.
 */
import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import { createDb } from "@/db/client";
import {
  assignments,
  assignmentTasks,
  feedbacks,
  privateNotes,
  profiles,
  qnaReplies,
  qnaThreads,
  type QnaStatus,
} from "@/db/schema";
import { requireAdmin } from "@/lib/auth-guard";
import { parseStoredMixAnalysis, type MixAnalysis } from "@/lib/mix-analysis";
import { publicAuthorName } from "@/lib/public-author-name";
import { withQnaAttachmentKinds } from "@/lib/qna-attachment-kinds";
import { ARCHIVED_ACCOUNT_STATUS } from "@/lib/student-status";
import { describeAssignmentSubmission } from "@/lib/unified-item-normalization";
import type { MediaAttachmentKind } from "@/lib/media-lifecycle";

export const ARCHIVED_RECORD_TABS = ["notes", "assignments", "qna"] as const;
export type ArchivedRecordTab = (typeof ARCHIVED_RECORD_TABS)[number];

export function resolveArchivedRecordTab(value: string | string[] | undefined): ArchivedRecordTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return (ARCHIVED_RECORD_TABS as readonly string[]).includes(raw ?? "") ? (raw as ArchivedRecordTab) : "notes";
}

export function buildArchivedStudentHref(studentId: string, tab: ArchivedRecordTab = "notes"): string {
  const base = `/dashboard/admin/students/archived/${encodeURIComponent(studentId)}`;
  return tab === "notes" ? base : `${base}?tab=${tab}`;
}

export type ArchivedStudentSummary = {
  id: string;
  name: string;
  email: string;
  archivedAt: Date | null;
};

export type ArchivedNoteRecord = { id: string; title: string; date: Date; contentHtml: string };

export type ArchivedAssignmentRecord = {
  id: string;
  title: string;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  mediaUrl: string | null;
  textHtml: string | null;
  analysis: MixAnalysis | null;
  feedbacks: { id: string; timeMarker: number | null; content: string; createdAt: Date | null }[];
};

export type ArchivedQnaRecord = {
  id: string;
  title: string;
  status: QnaStatus;
  createdAt: Date | null;
  replies: {
    id: string;
    contentHtml: string;
    attachmentUrl: string | null;
    attachmentKind: MediaAttachmentKind | null;
    createdAt: Date | null;
    authorName: string | null;
    authorRole: string | null;
  }[];
};

export type ArchivedStudentRecords = {
  student: ArchivedStudentSummary;
  counts: Record<ArchivedRecordTab, number>;
} & (
  | { tab: "notes"; rows: ArchivedNoteRecord[] }
  | { tab: "assignments"; rows: ArchivedAssignmentRecord[] }
  | { tab: "qna"; rows: ArchivedQnaRecord[] }
);

type Db = ReturnType<typeof createDb>;

/** 관리자 확인 뒤 수강 종료한 학생 profile만 돌려준다. 수강 중·관리자·없는 id는 null. */
async function findArchivedStudent(db: Db, studentId: string): Promise<ArchivedStudentSummary | null> {
  await requireAdmin();
  if (typeof studentId !== "string" || !studentId) return null;
  const [row] = await db
    .select({ id: profiles.id, displayName: profiles.displayName, email: profiles.email, archivedAt: profiles.archivedAt })
    .from(profiles)
    .where(and(eq(profiles.id, studentId), eq(profiles.role, "student"), eq(profiles.accountStatus, ARCHIVED_ACCOUNT_STATUS)))
    .limit(1);
  if (!row) return null;
  return { id: row.id, name: row.displayName?.trim() || row.email, email: row.email, archivedAt: row.archivedAt };
}

// 학생 상세·노트 목록과 같은 범위: 개인 노트(그룹 노트 제외, 휴지통 제외), 제출 전부, 휴지통이 아닌 질문.
const personalNotesOf = (studentId: string) =>
  and(eq(privateNotes.studentId, studentId), isNull(privateNotes.groupId), isNull(privateNotes.deletedAt));
const threadsOf = (studentId: string) => and(eq(qnaThreads.studentId, studentId), isNull(qnaThreads.deletedAt));

async function readCounts(db: Db, studentId: string): Promise<Record<ArchivedRecordTab, number>> {
  const [[notes], [submitted], [threads]] = await Promise.all([
    db.select({ value: count() }).from(privateNotes).where(personalNotesOf(studentId)),
    db.select({ value: count() }).from(assignments).where(eq(assignments.studentId, studentId)),
    db.select({ value: count() }).from(qnaThreads).where(threadsOf(studentId)),
  ]);
  return { notes: Number(notes?.value ?? 0), assignments: Number(submitted?.value ?? 0), qna: Number(threads?.value ?? 0) };
}

async function readNotes(db: Db, studentId: string): Promise<ArchivedNoteRecord[]> {
  const rows = await db
    .select({
      id: privateNotes.id,
      title: privateNotes.title,
      noteDate: privateNotes.noteDate,
      createdAt: privateNotes.createdAt,
      contentHtml: privateNotes.contentHtml,
    })
    .from(privateNotes)
    .where(personalNotesOf(studentId))
    .orderBy(desc(privateNotes.createdAt));
  return rows.map((row) => ({ id: row.id, title: row.title, date: row.noteDate ?? row.createdAt, contentHtml: row.contentHtml }));
}

async function readAssignments(db: Db, studentId: string): Promise<ArchivedAssignmentRecord[]> {
  const [rows, feedbackRows] = await Promise.all([
    db
      .select({
        id: assignments.id,
        mediaUrl: assignments.mediaUrl,
        textHtml: assignments.textHtml,
        analysisJson: assignments.analysisJson,
        submittedAt: assignments.submittedAt,
        reviewedAt: assignments.reviewedAt,
        taskTitle: assignmentTasks.title,
      })
      .from(assignments)
      .leftJoin(assignmentTasks, eq(assignmentTasks.id, assignments.taskId))
      .where(eq(assignments.studentId, studentId))
      .orderBy(desc(assignments.submittedAt)),
    // 피드백은 이 학생 제출에 달린 것만(제출 id 목록을 bind하지 않고 join으로 거른다).
    db
      .select({
        id: feedbacks.id,
        assignmentId: feedbacks.assignmentId,
        timeMarker: feedbacks.timeMarker,
        content: feedbacks.content,
        createdAt: feedbacks.createdAt,
      })
      .from(feedbacks)
      .innerJoin(assignments, eq(assignments.id, feedbacks.assignmentId))
      .where(eq(assignments.studentId, studentId))
      .orderBy(asc(feedbacks.createdAt)),
  ]);
  const byAssignment = new Map<string, ArchivedAssignmentRecord["feedbacks"]>();
  for (const { assignmentId, ...feedback } of feedbackRows) {
    byAssignment.set(assignmentId, [...(byAssignment.get(assignmentId) ?? []), feedback]);
  }
  return rows.map((row) => ({
    id: row.id,
    title: describeAssignmentSubmission({ mediaUrl: row.mediaUrl, taskTitle: row.taskTitle }),
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    mediaUrl: row.mediaUrl,
    textHtml: row.textHtml,
    analysis: parseStoredMixAnalysis(row.analysisJson),
    feedbacks: byAssignment.get(row.id) ?? [],
  }));
}

async function readQna(db: Db, studentId: string): Promise<ArchivedQnaRecord[]> {
  const [threads, replies] = await Promise.all([
    db
      .select({ id: qnaThreads.id, title: qnaThreads.title, status: qnaThreads.status, createdAt: qnaThreads.createdAt })
      .from(qnaThreads)
      .where(threadsOf(studentId))
      .orderBy(desc(qnaThreads.updatedAt)),
    db
      .select({
        id: qnaReplies.id,
        threadId: qnaReplies.threadId,
        contentHtml: qnaReplies.contentHtml,
        attachmentUrl: qnaReplies.attachmentUrl,
        attachmentObjectId: qnaReplies.attachmentObjectId,
        createdAt: qnaReplies.createdAt,
        authorName: publicAuthorName,
        authorRole: profiles.role,
      })
      .from(qnaReplies)
      .innerJoin(qnaThreads, eq(qnaThreads.id, qnaReplies.threadId))
      .leftJoin(profiles, eq(qnaReplies.authorId, profiles.id))
      .where(threadsOf(studentId))
      .orderBy(asc(qnaReplies.createdAt)),
  ]);
  const withKinds = await withQnaAttachmentKinds(replies);
  const byThread = new Map<string, ArchivedQnaRecord["replies"]>();
  for (const reply of withKinds) {
    byThread.set(reply.threadId, [...(byThread.get(reply.threadId) ?? []), {
      id: reply.id,
      contentHtml: reply.contentHtml,
      attachmentUrl: reply.attachmentUrl,
      attachmentKind: reply.attachmentKind,
      createdAt: reply.createdAt,
      authorName: reply.authorName,
      authorRole: reply.authorRole,
    }]);
  }
  return threads.map((thread) => ({ ...thread, replies: byThread.get(thread.id) ?? [] }));
}

/**
 * 보기 전용 상세 한 화면: 학생, 세 탭 숫자, 고른 탭의 줄(본문 포함). 수강 종료한 학생이 아니면 null.
 */
export async function loadArchivedStudentRecords(
  studentId: string,
  tab: ArchivedRecordTab,
): Promise<ArchivedStudentRecords | null> {
  const db = createDb();
  const student = await findArchivedStudent(db, studentId);
  if (!student) return null;
  const counts = await readCounts(db, student.id);
  if (tab === "assignments") return { student, counts, tab, rows: await readAssignments(db, student.id) };
  if (tab === "qna") return { student, counts, tab, rows: await readQna(db, student.id) };
  return { student, counts, tab: "notes", rows: await readNotes(db, student.id) };
}

/** 수강 종료한 학생인지(관리자만). 학생 상세가 보기 전용 상세로 보낼지 정할 때 쓴다. */
export async function isArchivedStudent(studentId: string): Promise<boolean> {
  return (await findArchivedStudent(createDb(), studentId)) !== null;
}
