import { createDbContext } from "@/db/client";
import { findAccountDeletionByCleanupTokenDigest } from "@/lib/account-privacy-atomic";
import { createAccountCleanupStatusHandler } from "@/lib/account-cleanup-handlers";

export const POST = createAccountCleanupStatusHandler({
  findDeletion: (tokenDigest) =>
    findAccountDeletionByCleanupTokenDigest(createDbContext(), tokenDigest),
});
