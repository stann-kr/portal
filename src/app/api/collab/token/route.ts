import { eq } from "drizzle-orm";
import { createDb, createDbContext } from "@/db/client";
import { guidePages, posts, privateNotes, qnaReplies, qnaThreads } from "@/db/schema";
import { privateNoteLifecycleSql } from "@/lib/private-note-atomic";
import { postLifecycleSql } from "@/lib/post-atomic";
import { findStudentTarget, getActiveAuthSession } from "@/lib/auth-guard";
import { readCollabWorkerEnv, repairCollabRoomIfBehind } from "@/lib/collab/server-env";
import { parseCollabDocKey } from "@/lib/collab/doc-key";
import { isCurrentLessonGroupMember } from "@/lib/note-access";
import { readGuideRestoreTarget, readNoteRestoreTarget, readPostRestoreTarget } from "@/lib/collab/restore-targets";
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
          groupId: privateNotes.groupId,
          studentReadOnly: privateNotes.studentReadOnly,
          deletedAt: privateNotes.deletedAt,
          // 권한·삭제 상태와 같은 조회에서 lifecycle 표지(마지막 복원 revision)를 읽는다.
          lifecycle: privateNoteLifecycleSql,
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
          lifecycle: postLifecycleSql,
        })
        .from(posts)
        .where(eq(posts.id, id))
        .limit(1);
      return row ? { ...row, lifecycle: Number(row.lifecycle) } : null;
    },
    async findGuidePage(id) {
      const [row] = await createDb()
        .select({ id: guidePages.id, deletedAt: guidePages.deletedAt, lifecycle: guidePages.collabLifecycle })
        .from(guidePages)
        .where(eq(guidePages.id, id))
        .limit(1);
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
    async findQnaReply(id) {
      const [row] = await createDb()
        .select({ authorId: qnaReplies.authorId, threadDeletedAt: qnaThreads.deletedAt })
        .from(qnaReplies)
        .innerJoin(qnaThreads, eq(qnaThreads.id, qnaReplies.threadId))
        .where(eq(qnaReplies.id, id))
        .limit(1);
      return row ?? null;
    },
    async isActiveStudent(id) {
      return (await findStudentTarget(id)) !== null;
    },
    async isGroupMember(studentId, groupId) {
      return isCurrentLessonGroupMember(createDbContext(), studentId, groupId);
    },
  },
  async repairRoom(key, lifecycle) {
    const parsed = parseCollabDocKey(key);
    if (!parsed || (parsed.kind !== "note" && parsed.kind !== "post" && parsed.kind !== "guide")) return;
    const id = parsed.id;
    const readTarget = { note: readNoteRestoreTarget, post: readPostRestoreTarget, guide: readGuideRestoreTarget }[parsed.kind];
    await repairCollabRoomIfBehind(key, lifecycle, () => readTarget(id));
  },
  getSecret: () => process.env.AUTH_SECRET,
  isCollabAvailable: () => readCollabWorkerEnv() !== null,
});
