import { eq, sql } from "drizzle-orm";
import { createDb } from "@/db/client";
import { guidePages, postRevisions, posts, privateNoteRevisions, privateNotes, qnaThreads } from "@/db/schema";
import { findStudentTarget, getActiveAuthSession } from "@/lib/auth-guard";
import { readCollabWorkerEnv } from "@/lib/collab/server-env";
import { createCollabTokenHandler } from "@/lib/collab/token-handler";

export const dynamic = "force-dynamic";

export const POST = createCollabTokenHandler({
  async getActor() {
    const session = await getActiveAuthSession();
    const id = session?.user?.id;
    if (!id) return null;
    const isAdmin = session.user.role === "admin";
    return { id, isAdmin, displayName: isAdmin ? "Stann" : session.user.name?.trim() || "학생" };
  },
  loaders: {
    async findNote(id) {
      const [row] = await createDb()
        .select({
          studentId: privateNotes.studentId,
          authorId: privateNotes.authorId,
          deletedAt: privateNotes.deletedAt,
          // 권한·삭제 상태와 같은 조회에서 lifecycle 표지(마지막 복원 revision)를 읽는다.
          lifecycle: sql<number>`coalesce((SELECT max(${privateNoteRevisions.revisionNumber}) FROM ${privateNoteRevisions} WHERE ${privateNoteRevisions.noteId} = ${privateNotes.id} AND ${privateNoteRevisions.changeType} = 'RESTORE_REVISION'), 0)`,
        })
        .from(privateNotes)
        .where(eq(privateNotes.id, id))
        .limit(1);
      return row ? { ...row, lifecycle: Number(row.lifecycle) } : null;
    },
    async findPost(id) {
      const [row] = await createDb()
        .select({
          authorId: posts.authorId,
          deletedAt: posts.deletedAt,
          lifecycle: sql<number>`coalesce((SELECT max(${postRevisions.revisionNumber}) FROM ${postRevisions} WHERE ${postRevisions.postId} = ${posts.id} AND ${postRevisions.changeType} = 'RESTORE_REVISION'), 0)`,
        })
        .from(posts)
        .where(eq(posts.id, id))
        .limit(1);
      return row ? { ...row, lifecycle: Number(row.lifecycle) } : null;
    },
    async findGuidePage(id) {
      const [row] = await createDb().select({ id: guidePages.id }).from(guidePages).where(eq(guidePages.id, id)).limit(1);
      return row ?? null;
    },
    async findQnaThread(id) {
      const [row] = await createDb()
        .select({ studentId: qnaThreads.studentId, deletedAt: qnaThreads.deletedAt })
        .from(qnaThreads)
        .where(eq(qnaThreads.id, id))
        .limit(1);
      return row ?? null;
    },
    async isActiveStudent(id) {
      return (await findStudentTarget(id)) !== null;
    },
  },
  getSecret: () => process.env.AUTH_SECRET,
  isCollabAvailable: () => readCollabWorkerEnv() !== null,
});
