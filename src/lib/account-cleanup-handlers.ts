import {
  accountCleanupJson,
  parseAccountCleanupRequest,
} from "@/lib/account-cleanup-api";
import type {
  AccountCleanupTokenLookup,
  RegisterAccountCleanupTokenResult,
} from "@/lib/account-privacy-atomic";

export type AccountCleanupRegisterHandlerDependencies = {
  requireSession: () => Promise<{ user: { id: string } }>;
  registerToken: (input: {
    ownerId: string;
    tokenDigest: string;
    now: Date;
  }) => Promise<RegisterAccountCleanupTokenResult>;
  now: () => Date;
};

export type AccountCleanupStatusHandlerDependencies = {
  findDeletion: (tokenDigest: string) =>
    Promise<AccountCleanupTokenLookup | null>;
};

export function createAccountCleanupRegisterHandler(
  dependencies: AccountCleanupRegisterHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const parsed = await parseAccountCleanupRequest(request);
    if (!parsed.ok) {
      return accountCleanupJson({ ok: false }, { status: 400 });
    }

    let ownerId: string;
    try {
      ownerId = (await dependencies.requireSession()).user.id;
    } catch {
      return accountCleanupJson({ ok: false }, { status: 401 });
    }

    try {
      const result = await dependencies.registerToken({
        ownerId,
        tokenDigest: parsed.value.tokenDigest,
        now: dependencies.now(),
      });
      if (!result.ok) {
        const status = result.reason === "INVALID_TOKEN_DIGEST"
          ? 400
          : result.reason === "STUDENT_NOT_FOUND"
            ? 403
            : 409;
        return accountCleanupJson({ ok: false }, { status });
      }
      return accountCleanupJson({ ok: true });
    } catch {
      return accountCleanupJson({ ok: false }, { status: 503 });
    }
  };
}

export function createAccountCleanupStatusHandler(
  dependencies: AccountCleanupStatusHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const parsed = await parseAccountCleanupRequest(request);
    if (!parsed.ok) {
      return accountCleanupJson({ ok: false }, { status: 400 });
    }

    try {
      const record = await dependencies.findDeletion(parsed.value.tokenDigest);
      const deleted = record?.tokenStatus !== "ACTIVE" &&
        (record?.deletionStatus === "ERASED" ||
          record?.deletionStatus === "ALIASED");
      // ACTIVE와 미등록 digest는 응답 shape·status를 동일하게 유지한다.
      return accountCleanupJson({
        ok: true,
        status: deleted ? "DELETED" : "NO_ACTION",
      });
    } catch {
      return accountCleanupJson({ ok: false }, { status: 503 });
    }
  };
}
