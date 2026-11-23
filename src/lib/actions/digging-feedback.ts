/**
 * @file src/lib/actions/digging-feedback.ts
 * @description 디깅한 날 모아 보기와 디깅 피드백(캔버스 FlowGaps1123 ②·④).
 *
 * - "디깅한 날"은 학생이 트랙을 넣은 날(created_at의 KST 날짜, 트랙 보드의 날짜 묶음과 같다)과
 *   플레이리스트의 dug_on, 피드백이 남은 날을 합친 것이다.
 * - 피드백은 학생·날짜마다 하나이고 관리자만 쓴다. 학생은 자기 피드백만 읽는다.
 * - 관리자 action은 requireStudentTarget으로 대상 학생을 확인하고 모든 쓰기를 student_id로 좁힌다.
 * - 고치기·지우기는 화면이 읽은 updated_at과 같을 때만 한다(다른 탭에서 먼저 고쳤으면 덮지 않는다).
 */
"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, sql } from "drizzle-orm";
import { createDb, type DrizzleDb } from "@/db/client";
import { diggingFeedbacks } from "@/db/schema";
import { listActiveStudentProfiles } from "@/lib/active-profile";
import { requireAdmin, requireAuth, requireStudentOwnerOrAdmin, requireStudentTarget } from "@/lib/auth-guard";
import { toKstDateInputValue } from "@/lib/date-input";
import { parseDiggingDate, parseDiggingFeedbackBody } from "@/lib/digging-contract";
import { pushMessages } from "@/lib/push/messages";
import { notifyPush } from "@/lib/push/notify";
import { getUnifiedItemSpaceLabel } from "@/lib/unified-item-normalization";

/** 관리자 디깅 화면이 보이는 최대 줄 수(최근 디깅한 날부터). */
const ADMIN_DIGGING_DAY_LIMIT = 200;
/** 학생 한 명의 디깅한 날을 읽는 최대 수(학생 상세 디깅 탭). */
const STUDENT_DIGGING_DAY_LIMIT = 366;

export type DiggingFeedback = {
  dugOn: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
};

export type DiggingDay = {
  studentId: string;
  dugOn: string;
  trackCount: number;
  playlistCount: number;
  feedback: DiggingFeedback | null;
};

export type AdminDiggingStudent = { id: string; label: string };

export type AdminDiggingOverview = {
  students: AdminDiggingStudent[];
  selectedStudentId: string | null;
  days: DiggingDay[];
};

export type DiggingFeedbackResult =
  | { ok: true; feedback: DiggingFeedback | null }
  | { ok: false; error: string };

const CONFLICT_MESSAGE = "다른 곳에서 이 날 피드백을 먼저 바꿨습니다. 새로고침해 바뀐 내용을 확인한 뒤 다시 저장해 주세요.";

type DayRow = {
  student_id: string;
  dug_on: string;
  track_count: number;
  playlist_count: number;
  body: string | null;
  created_at: number | null;
  updated_at: number | null;
};

/**
 * 학생들의 디깅한 날(최근 순). 학생 id 목록은 json 하나로 bind한다(D1 bind 100개 제한).
 * 트랙 날짜는 디깅 보드와 같이 created_at의 KST 날짜다.
 * `waitingFirst`면 피드백 전인 날을 먼저 담아, 줄 수 제한 때문에 오래된 피드백 전 날이 빠지지 않게 한다
 * (관리자 디깅은 두 목록으로 나눠 보이므로 각 목록 안의 최근 순은 그대로다).
 */
async function loadDiggingDays(
  db: DrizzleDb,
  studentIds: readonly string[],
  limit: number,
  { waitingFirst = false }: { waitingFirst?: boolean } = {},
): Promise<DiggingDay[]> {
  if (studentIds.length === 0) return [];
  const ids = JSON.stringify(studentIds);
  const rows = await db.all<DayRow>(sql`
    WITH days AS (
      SELECT t.user_id AS student_id, strftime('%Y-%m-%d', t.created_at, 'unixepoch', '+9 hours') AS dug_on, 1 AS tracks, 0 AS playlists
      FROM digging_tracks AS t
      WHERE t.user_id IN (SELECT value FROM json_each(${ids})) AND t.created_at IS NOT NULL
      UNION ALL
      SELECT p.user_id, p.dug_on, 0, 1
      FROM digging_playlists AS p
      WHERE p.user_id IN (SELECT value FROM json_each(${ids}))
      UNION ALL
      SELECT f.student_id, f.dug_on, 0, 0
      FROM digging_feedbacks AS f
      WHERE f.student_id IN (SELECT value FROM json_each(${ids}))
    ),
    grouped AS (
      SELECT student_id, dug_on, sum(tracks) AS track_count, sum(playlists) AS playlist_count
      FROM days
      GROUP BY student_id, dug_on
    )
    SELECT g.student_id, g.dug_on, g.track_count, g.playlist_count, fb.body, fb.created_at, fb.updated_at
    FROM grouped AS g
    LEFT JOIN digging_feedbacks AS fb ON fb.student_id = g.student_id AND fb.dug_on = g.dug_on
    ORDER BY ${waitingFirst ? sql`(fb.student_id IS NULL) DESC, ` : sql``}g.dug_on DESC, g.student_id
    LIMIT ${limit}`);
  return rows.map((row) => ({
    studentId: row.student_id,
    dugOn: row.dug_on,
    trackCount: Number(row.track_count),
    playlistCount: Number(row.playlist_count),
    feedback: row.body !== null && row.created_at !== null && row.updated_at !== null
      ? {
          dugOn: row.dug_on,
          body: row.body,
          createdAt: new Date(Number(row.created_at) * 1000),
          updatedAt: new Date(Number(row.updated_at) * 1000),
        }
      : null,
  }));
}

/** 관리자 디깅 화면: 수강 중인 학생 전체(또는 고른 한 명)의 디깅한 날. */
export async function getAdminDiggingOverview(input: { studentId?: string | null } = {}): Promise<AdminDiggingOverview> {
  await requireAdmin();
  const db = createDb();
  const profiles = await listActiveStudentProfiles(db);
  const students = profiles
    .map((profile) => ({ id: profile.id, label: getUnifiedItemSpaceLabel(profile) }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));
  const selectedStudentId = input.studentId && students.some((student) => student.id === input.studentId)
    ? input.studentId
    : null;
  const ids = selectedStudentId ? [selectedStudentId] : students.map((student) => student.id);
  return { students, selectedStudentId, days: await loadDiggingDays(db, ids, ADMIN_DIGGING_DAY_LIMIT, { waitingFirst: true }) };
}

/** 관리자 학생 상세 디깅 탭: 그 학생의 디깅한 날과 피드백. */
export async function getStudentDiggingDays(studentId: string): Promise<DiggingDay[]> {
  await requireStudentTarget(studentId);
  return loadDiggingDays(createDb(), [studentId], STUDENT_DIGGING_DAY_LIMIT);
}

/** 학생 본인(또는 관리자)이 보는 디깅 피드백 목록(최근 날짜 순). */
export async function getDiggingFeedbacks(studentId: string): Promise<DiggingFeedback[]> {
  const session = await requireAuth();
  await requireStudentOwnerOrAdmin(session, studentId);
  return createDb()
    .select({
      dugOn: diggingFeedbacks.dugOn,
      body: diggingFeedbacks.body,
      createdAt: diggingFeedbacks.createdAt,
      updatedAt: diggingFeedbacks.updatedAt,
    })
    .from(diggingFeedbacks)
    .where(eq(diggingFeedbacks.studentId, studentId))
    .orderBy(desc(diggingFeedbacks.dugOn));
}

/**
 * 피드백 남기기·고치기. `expectedUpdatedAt`(ms)이 null이면 새로 남기고, 이미 있으면 충돌로 돌려준다.
 * 값이 있으면 그 시각과 같은 피드백만 고친다. 새로 남길 때만 학생에게 알린다.
 */
export async function saveDiggingFeedback(
  studentId: string,
  input: { dugOn: string; body: string; expectedUpdatedAt: number | null },
): Promise<DiggingFeedbackResult> {
  await requireStudentTarget(studentId);
  const dugOn = parseDiggingDate(input?.dugOn, toKstDateInputValue());
  if (!dugOn.ok) return dugOn;
  const body = parseDiggingFeedbackBody(input?.body);
  if (!body.ok) return body;
  const db = createDb();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expected = input?.expectedUpdatedAt;
  let saved: DiggingFeedback | undefined;
  if (expected === null || expected === undefined) {
    [saved] = await db
      .insert(diggingFeedbacks)
      .values({ studentId, dugOn: dugOn.value, body: body.value, createdAt: new Date(nowSeconds * 1000), updatedAt: new Date(nowSeconds * 1000) })
      .onConflictDoNothing()
      .returning({ dugOn: diggingFeedbacks.dugOn, body: diggingFeedbacks.body, createdAt: diggingFeedbacks.createdAt, updatedAt: diggingFeedbacks.updatedAt });
    if (!saved) return { ok: false, error: CONFLICT_MESSAGE };
    await notifyPush({ kind: "profiles", profileIds: [studentId] }, pushMessages.diggingFeedbackAdded({ dugOn: dugOn.value }));
  } else {
    if (typeof expected !== "number" || !Number.isFinite(expected)) return { ok: false, error: CONFLICT_MESSAGE };
    const expectedSeconds = Math.floor(expected / 1000);
    // 같은 초에 다시 고쳐도 updated_at이 늘 커지게 해 다음 비교가 같은 값을 보지 않게 한다.
    [saved] = await db
      .update(diggingFeedbacks)
      .set({ body: body.value, updatedAt: new Date(Math.max(nowSeconds, expectedSeconds + 1) * 1000) })
      .where(and(
        eq(diggingFeedbacks.studentId, studentId),
        eq(diggingFeedbacks.dugOn, dugOn.value),
        eq(diggingFeedbacks.updatedAt, new Date(expectedSeconds * 1000)),
      ))
      .returning({ dugOn: diggingFeedbacks.dugOn, body: diggingFeedbacks.body, createdAt: diggingFeedbacks.createdAt, updatedAt: diggingFeedbacks.updatedAt });
    if (!saved) return { ok: false, error: CONFLICT_MESSAGE };
  }
  revalidateDiggingFeedback(studentId);
  return { ok: true, feedback: saved };
}

/** 피드백 지우기. 화면이 읽은 updated_at과 같을 때만 지운다. */
export async function deleteDiggingFeedback(
  studentId: string,
  input: { dugOn: string; expectedUpdatedAt: number },
): Promise<DiggingFeedbackResult> {
  await requireStudentTarget(studentId);
  const dugOn = parseDiggingDate(input?.dugOn, toKstDateInputValue());
  if (!dugOn.ok) return dugOn;
  const expected = input?.expectedUpdatedAt;
  if (typeof expected !== "number" || !Number.isFinite(expected)) return { ok: false, error: CONFLICT_MESSAGE };
  const deleted = await createDb()
    .delete(diggingFeedbacks)
    .where(and(
      eq(diggingFeedbacks.studentId, studentId),
      eq(diggingFeedbacks.dugOn, dugOn.value),
      eq(diggingFeedbacks.updatedAt, new Date(Math.floor(expected / 1000) * 1000)),
    ))
    .returning({ dugOn: diggingFeedbacks.dugOn });
  if (deleted.length === 0) return { ok: false, error: CONFLICT_MESSAGE };
  revalidateDiggingFeedback(studentId);
  return { ok: true, feedback: null };
}

function revalidateDiggingFeedback(studentId: string): void {
  revalidatePath("/dashboard/student/digging");
  revalidatePath("/dashboard/admin/digging");
  revalidatePath(`/dashboard/admin/students/${studentId}`);
}
