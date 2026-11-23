/**
 * 글 없이 보내는 알림(0037 `push_notices`·`push_notice_recipients`, 2026-11-23 사용자 결정 "글말고 알림만 보내는").
 * 관리자만 보내고·보고·다시 알리고·지운다. 학생은 자기가 받은 알림만 읽고 읽음으로 바꾼다.
 * 받는 사람은 보낸 순간의 수강 중 학생으로 고정한다. 학생이 알림을 눌러 열거나 홈 카드에서 "확인"을 누르면 읽음이다.
 */
"use server";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { createDb } from "@/db/client";
import { PUSH_NOTICE_MAX_LENGTH, profiles, pushNoticeRecipients, pushNotices } from "@/db/schema";
import { requireAdmin, requireAuth } from "@/lib/auth-guard";
import { parseCreationOperationId } from "@/lib/creation-operation";
import { INVITE_HASH_PREFIX } from "@/lib/password-storage";
import { notifyPush } from "@/lib/push/notify";
import { pushMessages } from "@/lib/push/messages";
import { publicAuthorName } from "@/lib/public-author-name";
import { createSecureUuid } from "@/lib/secure-uuid";
import { activeSignedUpStudent, findPushOffStudentIds, PUSH_REMINDER_COOLDOWN_SECONDS } from "@/lib/push-notice-audience";

const ID_CHUNK = 90;
const LIST_LIMIT = 50;
const STUDENT_CARD_LIMIT = 10;

export type PushNoticeRow = {
  id: string;
  body: string;
  createdAt: Date;
  readCount: number;
  recipientCount: number;
};

export type PushNoticeSummary = {
  readers: { id: string; name: string; readAt: Date }[];
  unread: { id: string; name: string; pushOff: boolean }[];
  lastRemindedAt: Date | null;
};

export type StudentPushNotice = { id: string; body: string; createdAt: Date };

type ActionResult<T> = ({ success: true } & T) | { success: false; error: string };

/** 120자 안의 한 덩어리 글. 앞뒤 공백을 지우고 줄바꿈 셋 이상은 둘로 줄인다. */
function normalizeBody(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const body = value.replace(/\r\n?/gu, "\n").replace(/\n{3,}/gu, "\n\n").trim();
  if (!body || [...body].length > PUSH_NOTICE_MAX_LENGTH) return null;
  return body;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** 받는 학생을 고정해 넣는다. studentIds가 없으면 세는 학생 전체. 다시 불러도 같은 학생은 한 줄이다. */
async function insertRecipients(noticeId: string, studentIds: readonly string[] | null): Promise<void> {
  const db = createDb();
  const base = sql`
    INSERT OR IGNORE INTO push_notice_recipients (notice_id, student_id)
    SELECT ${noticeId}, id FROM profiles
    WHERE role = 'student' AND account_status = 'ACTIVE'
      AND (password_hash IS NULL OR password_hash NOT LIKE ${`${INVITE_HASH_PREFIX}%`})`;
  if (!studentIds) {
    await db.run(base);
    return;
  }
  const ids = [...new Set(studentIds)].filter((id) => typeof id === "string" && id);
  for (let start = 0; start < ids.length; start += ID_CHUNK) {
    const chunk = ids.slice(start, start + ID_CHUNK);
    await db.run(sql`${base} AND id IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})`);
  }
}

async function recipientIds(noticeId: string, onlyUnread: boolean): Promise<string[]> {
  const rows = await createDb()
    .select({ id: pushNoticeRecipients.studentId })
    .from(pushNoticeRecipients)
    .innerJoin(profiles, eq(profiles.id, pushNoticeRecipients.studentId))
    .where(and(
      eq(pushNoticeRecipients.noticeId, noticeId),
      activeSignedUpStudent,
      onlyUnread ? isNull(pushNoticeRecipients.readAt) : undefined,
    ));
  return rows.map((row) => row.id);
}

/** 관리자: 알림을 보낸다. 같은 operationId(두 번 누름·재시도)는 알림 하나만 만든다. */
export async function sendPushNotice(input: {
  body: string;
  studentIds: string[] | null;
  operationId: string;
}): Promise<ActionResult<{ noticeId: string; recipientCount: number }>> {
  const session = await requireAdmin();
  const body = normalizeBody(input?.body);
  if (!body) return { success: false, error: `알림 내용을 1~${PUSH_NOTICE_MAX_LENGTH}자로 적어 주세요.` };
  const requestId = parseCreationOperationId(input?.operationId);
  if (!requestId) return { success: false, error: "요청을 확인하지 못했습니다. 다시 시도해 주세요." };
  const studentIds = input.studentIds === null ? null : Array.isArray(input.studentIds) ? input.studentIds : [];
  if (studentIds && studentIds.length === 0) return { success: false, error: "받을 학생을 한 명 이상 골라 주세요." };

  const db = createDb();
  await db.run(sql`
    INSERT OR IGNORE INTO push_notices (id, author_id, request_id, body, created_at)
    VALUES (${createSecureUuid()}, ${session.user.id}, ${requestId}, ${body}, ${nowSeconds()})
  `);
  const [notice] = await db
    .select({ id: pushNotices.id, body: pushNotices.body })
    .from(pushNotices)
    .where(eq(pushNotices.requestId, requestId))
    .limit(1);
  if (!notice) return { success: false, error: "알림을 저장하지 못했습니다. 다시 시도해 주세요." };

  // 앞 요청이 받는 학생을 넣기 전에 끝났으면 이어서 넣고 보낸다. 이미 넣었으면 다시 보내지 않는다.
  const existing = await recipientIds(notice.id, false);
  if (existing.length > 0) return { success: true, noticeId: notice.id, recipientCount: existing.length };
  await insertRecipients(notice.id, studentIds);
  const recipients = await recipientIds(notice.id, false);
  if (recipients.length === 0) {
    await db.delete(pushNotices).where(eq(pushNotices.id, notice.id));
    return { success: false, error: "알림을 받을 수강 중인 학생이 없습니다." };
  }
  await notifyPush(
    { kind: "profiles", profileIds: recipients },
    pushMessages.pushNotice({ noticeId: notice.id, body: notice.body }),
    { excludeProfileId: session.user.id },
  );
  return { success: true, noticeId: notice.id, recipientCount: recipients.length };
}

/** 관리자: 최근 보낸 알림과 읽은 수(수강 중인 학생만 센다). */
export async function listPushNotices(): Promise<PushNoticeRow[]> {
  await requireAdmin();
  const db = createDb();
  const notices = await db
    .select({ id: pushNotices.id, body: pushNotices.body, createdAt: pushNotices.createdAt })
    .from(pushNotices)
    .orderBy(desc(pushNotices.createdAt), desc(pushNotices.id))
    .limit(LIST_LIMIT);
  if (notices.length === 0) return [];
  const counts = new Map<string, { total: number; read: number }>();
  for (let start = 0; start < notices.length; start += ID_CHUNK) {
    const rows = await db
      .select({
        noticeId: pushNoticeRecipients.noticeId,
        total: sql<number>`count(*)`,
        read: sql<number>`count(${pushNoticeRecipients.readAt})`,
      })
      .from(pushNoticeRecipients)
      .innerJoin(profiles, eq(profiles.id, pushNoticeRecipients.studentId))
      .where(and(
        inArray(pushNoticeRecipients.noticeId, notices.slice(start, start + ID_CHUNK).map((notice) => notice.id)),
        activeSignedUpStudent,
      ))
      .groupBy(pushNoticeRecipients.noticeId);
    for (const row of rows) counts.set(row.noticeId, { total: Number(row.total), read: Number(row.read) });
  }
  return notices.map((notice) => ({
    ...notice,
    recipientCount: counts.get(notice.id)?.total ?? 0,
    readCount: counts.get(notice.id)?.read ?? 0,
  }));
}

/** 관리자: 이 알림을 읽은 학생(읽은 순)과 아직 안 읽은 학생(이름순, 알림 꺼짐 표시). */
export async function getPushNoticeSummary(noticeId: string): Promise<PushNoticeSummary | null> {
  await requireAdmin();
  if (typeof noticeId !== "string" || !noticeId) return null;
  const db = createDb();
  const [notice] = await db
    .select({ lastRemindedAt: pushNotices.lastRemindedAt })
    .from(pushNotices)
    .where(eq(pushNotices.id, noticeId))
    .limit(1);
  if (!notice) return null;
  const rows = await db
    .select({ id: profiles.id, name: publicAuthorName, readAt: pushNoticeRecipients.readAt })
    .from(pushNoticeRecipients)
    .innerJoin(profiles, eq(profiles.id, pushNoticeRecipients.studentId))
    .where(and(eq(pushNoticeRecipients.noticeId, noticeId), activeSignedUpStudent))
    .orderBy(asc(pushNoticeRecipients.readAt), asc(profiles.id));
  const unreadRows = rows.filter((row) => !row.readAt);
  const pushOff = await findPushOffStudentIds(db, unreadRows.map((row) => row.id));
  return {
    readers: rows
      .filter((row): row is typeof row & { readAt: Date } => row.readAt instanceof Date)
      .map((row) => ({ id: row.id, name: row.name ?? "이름 없음", readAt: row.readAt })),
    unread: unreadRows
      .map((row) => ({ id: row.id, name: row.name ?? "이름 없음", pushOff: pushOff.has(row.id) }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    lastRemindedAt: notice.lastRemindedAt ?? null,
  };
}

/** 관리자: 안 읽은 학생에게만 같은 알림을 다시 보낸다. 10분 안에 다시 누르면 거절한다. */
export async function remindPushNotice(noticeId: string): Promise<ActionResult<{ sentTo: number; remindedAt: Date }>> {
  const session = await requireAdmin();
  if (typeof noticeId !== "string" || !noticeId) return { success: false, error: "알림을 찾지 못했습니다." };
  const db = createDb();
  const unread = await recipientIds(noticeId, true);
  if (unread.length === 0) return { success: false, error: "안 읽은 학생이 없습니다." };
  const now = nowSeconds();
  const claimed = await db
    .update(pushNotices)
    .set({ lastRemindedAt: new Date(now * 1000) })
    .where(and(
      eq(pushNotices.id, noticeId),
      sql`(${pushNotices.lastRemindedAt} IS NULL OR ${pushNotices.lastRemindedAt} <= ${now - PUSH_REMINDER_COOLDOWN_SECONDS})`,
    ))
    .returning({ id: pushNotices.id, body: pushNotices.body });
  if (claimed.length === 0) return { success: false, error: "방금 다시 알렸습니다. 10분 뒤에 다시 보낼 수 있습니다." };
  await notifyPush(
    { kind: "profiles", profileIds: unread },
    pushMessages.pushNotice({ noticeId, body: claimed[0].body }),
    { excludeProfileId: session.user.id },
  );
  return { success: true, sentTo: unread.length, remindedAt: new Date(now * 1000) };
}

/** 관리자: 보낸 알림을 지운다. 학생 홈 카드도 함께 사라진다(받은 기록 cascade). */
export async function deletePushNotice(noticeId: string): Promise<ActionResult<object>> {
  await requireAdmin();
  if (typeof noticeId !== "string" || !noticeId) return { success: false, error: "알림을 찾지 못했습니다." };
  await createDb().delete(pushNotices).where(eq(pushNotices.id, noticeId));
  return { success: true };
}

/** 학생: 아직 확인하지 않은, 나에게 온 알림(최신 위). 관리자는 빈 목록. */
export async function getMyUnreadPushNotices(): Promise<StudentPushNotice[]> {
  const session = await requireAuth();
  if (session.user.role !== "student" || !session.user.id) return [];
  return createDb()
    .select({ id: pushNotices.id, body: pushNotices.body, createdAt: pushNotices.createdAt })
    .from(pushNoticeRecipients)
    .innerJoin(pushNotices, eq(pushNotices.id, pushNoticeRecipients.noticeId))
    .where(and(eq(pushNoticeRecipients.studentId, session.user.id), isNull(pushNoticeRecipients.readAt)))
    .orderBy(desc(pushNotices.createdAt), desc(pushNotices.id))
    .limit(STUDENT_CARD_LIMIT);
}

/** 학생: 나에게 온 알림을 읽음으로 남긴다(처음 한 번). 받지 않은 알림·관리자는 아무것도 바꾸지 않는다. */
export async function markPushNoticeRead(noticeId: string): Promise<void> {
  const session = await requireAuth();
  if (session.user.role !== "student" || !session.user.id) return;
  if (typeof noticeId !== "string" || !noticeId) return;
  await createDb()
    .update(pushNoticeRecipients)
    .set({ readAt: new Date(nowSeconds() * 1000) })
    .where(and(
      eq(pushNoticeRecipients.noticeId, noticeId),
      eq(pushNoticeRecipients.studentId, session.user.id),
      isNull(pushNoticeRecipients.readAt),
    ));
}

/** 관리자: 알림 보내기 창의 "고르기" 목록(수강 중이고 로그인할 수 있는 학생, 이름순). */
export async function listPushNoticeStudents(): Promise<{ id: string; name: string }[]> {
  await requireAdmin();
  const rows = await createDb()
    .select({ id: profiles.id, name: publicAuthorName })
    .from(profiles)
    .where(activeSignedUpStudent);
  return rows
    .map((row) => ({ id: row.id, name: row.name ?? "이름 없음" }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
