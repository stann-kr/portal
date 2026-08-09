"use server";

import * as bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { createDb, createDbContext } from "@/db/client";
import { profiles } from "@/db/schema";
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

/** 학생 본인만 현재 비밀번호와 persistent 또는 memory-only digest로 삭제한다. */
export async function deleteOwnAccount(
  input: DeleteOwnAccountInput,
): Promise<DeleteOwnAccountResult> {
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
    comparePassword: bcrypt.compare,
    enqueueExpiredMedia: (now) => enqueueExpiredUnattachedMedia(context, now),
    deleteAccount: (deletionInput) =>
      deleteStudentAccountAtomically(context, deletionInput),
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
