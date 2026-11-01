"use server";

import { eq, or } from "drizzle-orm";
import { createDb, createDbContext } from "@/db/client";
import { posts, privateNotes, profiles } from "@/db/schema";
import { formatCollabDocKey } from "@/lib/collab/doc-key";
import { closeCollabRoomAfterMutation } from "@/lib/collab/server-env";
import {
  deleteStudentAccountAtomically,
  processDueAccountRawIdErasures,
} from "@/lib/account-privacy-atomic";
import { requireAdmin, requireAuth } from "@/lib/auth-guard";
import {
  executeDeleteOwnAccount,
  type DeleteOwnAccountInput,
  type DeleteOwnAccountResult,
} from "@/lib/delete-own-account";
import {
  enqueueExpiredUnattachedMedia,
  processMediaDeletionOutboxBestEffort,
} from "@/lib/media-lifecycle-atomic";
import { isAccountDeletionEnabled } from "@/lib/account-privacy-rollout";
import { verifyStoredPassword } from "@/lib/password-storage";
import { headers } from "next/headers";
import { isPasswordAttemptAllowed, PASSWORD_ATTEMPT_LIMITED_MESSAGE } from "@/lib/password-attempt-limit";

/** 학생 본인만 현재 비밀번호와 persistent 또는 memory-only digest로 삭제한다. */
export async function deleteOwnAccount(
  input: DeleteOwnAccountInput,
): Promise<DeleteOwnAccountResult> {
  if (!isAccountDeletionEnabled()) {
    return {
      success: false,
      error: "계정 삭제 기능을 안전하게 준비하고 있습니다. 잠시 뒤 다시 확인해 주세요.",
    };
  }
  if (!(await isPasswordAttemptAllowed("account-deletion", headers))) {
    return { success: false, error: PASSWORD_ATTEMPT_LIMITED_MESSAGE };
  }
  const db = createDb();
  const context = createDbContext();
  return executeDeleteOwnAccount(input, {
    requireSession: requireAuth,
    loadProfileCredentials: async (ownerId) => {
      const [profile] = await db
        .select({ role: profiles.role, passwordHash: profiles.passwordHash })
        .from(profiles)
        .where(eq(profiles.id, ownerId))
        .limit(1);
      if (
        !profile ||
        (profile.role !== "student" && profile.role !== "admin")
      ) return null;
      return {
        role: profile.role,
        passwordHash: profile.passwordHash,
      };
    },
    comparePassword: verifyStoredPassword,
    enqueueExpiredMedia: (now) => enqueueExpiredUnattachedMedia(context, now),
    deleteAccount: async (deletionInput) => {
      // 지울 문서의 공동 편집 room을 먼저 모은다(삭제 뒤에는 찾을 수 없다). 성공하면 열린 연결을 바로 닫는다.
      const owner = deletionInput.actorId;
      const [notes, ownPosts] = await Promise.all([
        db
          .select({ id: privateNotes.id })
          .from(privateNotes)
          .where(or(eq(privateNotes.studentId, owner), eq(privateNotes.authorId, owner))),
        db.select({ id: posts.id }).from(posts).where(eq(posts.authorId, owner)),
      ]);
      const result = await deleteStudentAccountAtomically(context, deletionInput);
      if (result.ok) {
        const keys = [
          ...notes.map((note) => formatCollabDocKey({ kind: "note", id: note.id })),
          ...ownPosts.map((post) => formatCollabDocKey({ kind: "post", id: post.id })),
          formatCollabDocKey({ kind: "notify", topic: "student-notes", id: owner }),
        ];
        await Promise.allSettled(keys.map((key) => closeCollabRoomAfterMutation(key, false)));
      }
      return result;
    },
    processStorageCleanup: () =>
      processMediaDeletionOutboxBestEffort(context, { limit: 1 }),
    now: () => new Date(),
  });
}

/** 운영자가 30일이 지난 raw subject ID를 alias로 수렴시킨다. */
export async function processDueAccountErasures(limit = 10) {
  await requireAdmin();
  const boundedLimit = Number.isSafeInteger(limit)
    ? Math.min(Math.max(limit, 1), 25)
    : 10;
  return processDueAccountRawIdErasures(createDbContext(), {
    now: new Date(),
    limit: boundedLimit,
  });
}
