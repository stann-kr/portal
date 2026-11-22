/**
 * 커뮤니티 게시물 읽음 기록(0034 `post_reads`). 학생이 게시물을 처음 연 때를 한 번 남기고,
 * 관리자만 누가 언제 읽었는지 본다(2026-11-23 사용자 결정). 글쓴이·관리자가 연 것은 남기지 않는다.
 */
"use server";

import { and, asc, eq, isNull, ne, notLike, or, sql } from "drizzle-orm";
import { createDb } from "@/db/client";
import { postReads, posts, profiles } from "@/db/schema";
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
  unread: { id: string; name: string }[];
};

/**
 * 관리자 전용: 이 게시물을 읽은 학생(처음 읽은 순)과 아직 안 읽은 학생(이름순). 글쓴이는 둘 다에서 뺀다.
 * 안 읽은 학생은 로그인할 수 있는 학생만 센다. 가입 전(비밀번호를 아직 정하지 않음) 학생은 읽을 수 없어 빼 둔다.
 */
export async function getPostReadSummary(postId: string): Promise<PostReadSummary | null> {
  await requireAdmin();
  const db = createDb();
  const [post] = await db.select({ authorId: posts.authorId }).from(posts).where(eq(posts.id, postId)).limit(1);
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
  return {
    readers: readRows.map((row) => ({ id: row.id, name: row.name ?? "이름 없음", firstReadAt: row.firstReadAt })),
    unread: students
      .filter((student) => !readIds.has(student.id))
      .map((student) => ({ id: student.id, name: student.name ?? "이름 없음" }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
  };
}
