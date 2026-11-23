/**
 * 커뮤니티 게시물 읽음 기록(0034 `post_reads`). 학생이 게시물을 처음 연 때를 한 번 남기고,
 * 관리자만 누가 언제 읽었는지 본다(2026-11-23 사용자 결정). 글쓴이·관리자가 연 것은 남기지 않는다.
 */
"use server";

import { and, asc, eq, isNull, ne, notLike, or, sql } from "drizzle-orm";
import { createDb } from "@/db/client";
import { postReads, postReminders, posts, profiles } from "@/db/schema";
import { notifyPush } from "@/lib/push/notify";
import { pushMessages } from "@/lib/push/messages";
import { findPushOffStudentIds, PUSH_REMINDER_COOLDOWN_SECONDS } from "@/lib/push-notice-audience";
import { requireAdmin, requireAuth } from "@/lib/auth-guard";
import { INVITE_HASH_PREFIX } from "@/lib/password-storage";
import { publicAuthorName } from "@/lib/public-author-name";

/**
 * 학생이 게시물 상세를 열었을 때 부른다. 처음 한 번만 남고 다시 열어도 시각은 바뀌지 않는다.
 * 관리자·글쓴이, 휴지통에 있거나 없는 게시물은 아무것도 남기지 않는다.
 */
export async function recordPostRead(postId: string): Promise<void> {
  const session = await requireAuth();
  if (session.user.role !== "student") return;
  const studentId = session.user.id;
  if (typeof postId !== "string" || !postId || !studentId) return;
  const now = Math.floor(Date.now() / 1000);
  await createDb().run(sql`
    INSERT OR IGNORE INTO post_reads (post_id, student_id, first_read_at)
    SELECT id, ${studentId}, ${now} FROM posts
    WHERE id = ${postId} AND deleted_at IS NULL AND author_id <> ${studentId}
  `);
}

export type PostReader = { id: string; name: string; firstReadAt: Date };
export type PostReadSummary = {
  readers: PostReader[];
  /** pushOff: 알림 받을 기기가 없거나 공지 알림을 끈 학생. */
  unread: { id: string; name: string; pushOff: boolean }[];
  /** 공지 게시물이면 안 읽은 학생에게 다시 알릴 수 있다. */
  canRemind: boolean;
  lastRemindedAt: Date | null;
};

/**
 * 관리자 전용: 이 게시물을 읽은 학생(처음 읽은 순)과 아직 안 읽은 학생(이름순). 글쓴이는 둘 다에서 뺀다.
 * 안 읽은 학생은 로그인할 수 있는 학생만 센다. 가입 전(비밀번호를 아직 정하지 않음) 학생은 읽을 수 없어 빼 둔다.
 */
export async function getPostReadSummary(postId: string): Promise<PostReadSummary | null> {
  await requireAdmin();
  const db = createDb();
  const [post] = await db
    .select({ authorId: posts.authorId, boardType: posts.boardType, lastRemindedAt: postReminders.lastRemindedAt })
    .from(posts)
    .leftJoin(postReminders, eq(postReminders.postId, posts.id))
    .where(eq(posts.id, postId))
    .limit(1);
  if (!post) return null;

  const activeStudent = and(
    eq(profiles.role, "student"),
    eq(profiles.accountStatus, "ACTIVE"),
    ne(profiles.id, post.authorId),
  );
  const [readRows, students] = await Promise.all([
    db
      .select({ id: profiles.id, name: publicAuthorName, firstReadAt: postReads.firstReadAt })
      .from(postReads)
      .innerJoin(profiles, eq(profiles.id, postReads.studentId))
      .where(and(eq(postReads.postId, postId), activeStudent))
      .orderBy(asc(postReads.firstReadAt), asc(profiles.id)),
    db
      .select({ id: profiles.id, name: publicAuthorName })
      .from(profiles)
      .where(and(
        activeStudent,
        // 가입 링크 hash만 가입 전으로 본다(storedCredentialState·학생 삭제 조건과 같은 기준).
        or(isNull(profiles.passwordHash), notLike(profiles.passwordHash, `${INVITE_HASH_PREFIX}%`)),
      )),
  ]);

  const readIds = new Set(readRows.map((row) => row.id));
  const unread = students.filter((student) => !readIds.has(student.id));
  const pushOff = await findPushOffStudentIds(db, unread.map((student) => student.id));
  return {
    readers: readRows.map((row) => ({ id: row.id, name: row.name ?? "이름 없음", firstReadAt: row.firstReadAt })),
    unread: unread
      .map((student) => ({ id: student.id, name: student.name ?? "이름 없음", pushOff: pushOff.has(student.id) }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    canRemind: post.boardType === "ANNOUNCEMENT",
    lastRemindedAt: post.lastRemindedAt ?? null,
  };
}

/**
 * 관리자 전용: 공지 게시물을 아직 안 읽은 학생에게만 다시 알린다(2026-11-23 사용자 결정 "안읽은 학생 알림").
 * 휴지통에 있는 글·공지가 아닌 글은 거절하고, 10분 안에 다시 누르면 보내지 않는다.
 */
export async function remindPostUnread(
  postId: string,
): Promise<{ success: true; sentTo: number; remindedAt: Date } | { success: false; error: string }> {
  const session = await requireAdmin();
  if (typeof postId !== "string" || !postId) return { success: false, error: "게시물을 찾지 못했습니다." };
  const summary = await getPostReadSummary(postId);
  if (!summary || !summary.canRemind) return { success: false, error: "공지 게시물만 다시 알릴 수 있습니다." };
  if (summary.unread.length === 0) return { success: false, error: "안 읽은 학생이 없습니다." };
  const db = createDb();
  const [target] = await db.select({ title: posts.title, deletedAt: posts.deletedAt }).from(posts).where(eq(posts.id, postId)).limit(1);
  if (!target || target.deletedAt) return { success: false, error: "휴지통에 있는 공지는 다시 알릴 수 없습니다." };
  const now = Math.floor(Date.now() / 1000);
  const claimed = await db.all<{ post_id: string }>(sql`
    INSERT INTO post_reminders (post_id, last_reminded_at)
    SELECT id, ${now} FROM posts
    WHERE id = ${postId} AND board_type = 'ANNOUNCEMENT' AND deleted_at IS NULL
    ON CONFLICT(post_id) DO UPDATE SET last_reminded_at = excluded.last_reminded_at
    WHERE post_reminders.last_reminded_at <= ${now - PUSH_REMINDER_COOLDOWN_SECONDS}
    RETURNING post_id
  `);
  if (claimed.length === 0) return { success: false, error: "방금 다시 알렸습니다. 10분 뒤에 다시 보낼 수 있습니다." };
  await notifyPush(
    { kind: "profiles", profileIds: summary.unread.map((student) => student.id) },
    pushMessages.announcementReminder({ postId, title: target.title }),
    { excludeProfileId: session.user.id },
  );
  return { success: true, sentTo: summary.unread.length, remindedAt: new Date(now * 1000) };
}
