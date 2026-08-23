import { createDbContext } from "@/db/client";
import { registerAccountCleanupTokenAtomically } from "@/lib/account-privacy-atomic";
import { createAccountCleanupRegisterHandler } from "@/lib/account-cleanup-handlers";
import { requireAuth } from "@/lib/auth-guard";

export const POST = createAccountCleanupRegisterHandler({
  requireSession: requireAuth,
  registerToken: (input) =>
    registerAccountCleanupTokenAtomically(createDbContext(), input),
  now: () => new Date(),
});
