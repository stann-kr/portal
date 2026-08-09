import assert from "node:assert/strict";
import test from "node:test";
import type { DeleteStudentAccountResult } from "./account-privacy-atomic";
import {
  executeDeleteOwnAccount,
  type DeleteOwnAccountDependencies,
  type DeleteOwnAccountInput,
} from "./delete-own-account";

const OPERATION_ID = "00000000-0000-4000-8000-000000000001";
const TOKEN_DIGEST = "a".repeat(64);
const NOW = new Date("2026-01-01T00:00:00.000Z");

const VALID_INPUT: DeleteOwnAccountInput = {
  password: "correct-password",
  confirmation: "계정 삭제",
  operationId: OPERATION_ID,
  cleanupTokenDigest: TOKEN_DIGEST,
  useEphemeralCleanupDigest: false,
};

function successResult(status: "DELETED" | "REPLAYED" = "DELETED"):
  DeleteStudentAccountResult {
  return {
    ok: true,
    status,
    deletionJobId: "delete-job",
    deletionStatus: "ERASED",
    rawIdEraseAfter: new Date("2026-01-31T00:00:00.000Z"),
  };
}

function createDependencies(
  overrides: Partial<DeleteOwnAccountDependencies> = {},
): DeleteOwnAccountDependencies {
  return {
    requireSession: async () => ({
      user: { id: "student-1", role: "student" },
    }),
    loadProfileCredentials: async () => ({
      role: "student",
      passwordHash: "stored-hash",
    }),
    comparePassword: async () => true,
    enqueueExpiredMedia: async () => undefined,
    deleteAccount: async () => successResult(),
    processStorageCleanup: async () => undefined,
    now: () => NOW,
    ...overrides,
  };
}

test("계정 삭제 orchestration은 인증·student·확인 입력을 먼저 거부한다", async () => {
  let profileReads = 0;
  assert.deepEqual(
    await executeDeleteOwnAccount(
      { ...VALID_INPUT, confirmation: "삭제" },
      createDependencies({
        loadProfileCredentials: async () => {
          profileReads += 1;
          return null;
        },
      }),
    ),
    {
      success: false,
      reason: "INVALID_INPUT",
      error: "확인 문구 “계정 삭제”와 현재 비밀번호를 정확히 입력해 주세요.",
    },
  );
  assert.equal(profileReads, 0);

  assert.equal(
    (
      await executeDeleteOwnAccount(
        VALID_INPUT,
        createDependencies({
          requireSession: async () => ({
            user: { id: "admin-1", role: "admin" },
          }),
        }),
      )
    ).success,
    false,
  );
  assert.deepEqual(
    await executeDeleteOwnAccount(
      VALID_INPUT,
      createDependencies({
        requireSession: async () => {
          throw new Error("expired");
        },
      }),
    ),
    { success: false, error: "로그인이 만료되었습니다." },
  );
});

test("현재 비밀번호 불일치는 원자 삭제와 media 수렴 전에 끝난다", async () => {
  let expiryRuns = 0;
  let deleteRuns = 0;
  const result = await executeDeleteOwnAccount(
    VALID_INPUT,
    createDependencies({
      comparePassword: async () => false,
      enqueueExpiredMedia: async () => {
        expiryRuns += 1;
      },
      deleteAccount: async () => {
        deleteRuns += 1;
        return successResult();
      },
    }),
  );
  assert.deepEqual(result, {
    success: false,
    reason: "PASSWORD_MISMATCH",
    error: "현재 비밀번호가 올바르지 않습니다.",
  });
  assert.equal(expiryRuns, 0);
  assert.equal(deleteRuns, 0);
});

test("media expiry 수렴 실패는 삭제를 fail closed하고 결과를 과장하지 않는다", async () => {
  let deleteRuns = 0;
  const result = await executeDeleteOwnAccount(
    VALID_INPUT,
    createDependencies({
      enqueueExpiredMedia: async () => {
        throw new Error("D1 unavailable");
      },
      deleteAccount: async () => {
        deleteRuns += 1;
        return successResult();
      },
    }),
  );
  assert.deepEqual(result, {
    success: false,
    error: "계정 삭제 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.",
  });
  assert.equal(deleteRuns, 0);
});

test("active seal 실패를 사용자 복구 메시지로 보존한다", async () => {
  const result = await executeDeleteOwnAccount(
    VALID_INPUT,
    createDependencies({
      deleteAccount: async () => ({ ok: false, reason: "ACTIVE_MEDIA_SEAL" }),
    }),
  );
  assert.deepEqual(result, {
    success: false,
    reason: "ACTIVE_MEDIA_SEAL",
    error: "파일 업로드 완료 처리가 진행 중입니다. 잠시 기다린 뒤 다시 시도해 주세요.",
  });
});

test("원자 삭제와 expiry는 같은 시각을 쓰고 storage retry 실패도 성공을 뒤집지 않는다", async () => {
  let expiryNow: Date | null = null;
  let deletionNow: Date | null = null;
  const result = await executeDeleteOwnAccount(
    VALID_INPUT,
    createDependencies({
      enqueueExpiredMedia: async (now) => {
        expiryNow = now;
      },
      deleteAccount: async (input) => {
        deletionNow = input.now;
        assert.equal(input.actorId, "student-1");
        assert.equal(input.operationId, OPERATION_ID);
        assert.equal(input.initiatingCleanupTokenDigest, TOKEN_DIGEST);
        assert.equal(input.useEphemeralCleanupDigest, false);
        return successResult("REPLAYED");
      },
      processStorageCleanup: async () => {
        throw new Error("R2 temporarily unavailable");
      },
    }),
  );
  assert.equal(expiryNow, NOW);
  assert.equal(deletionNow, NOW);
  assert.deepEqual(result, {
    success: true,
    replayed: true,
    rawIdEraseAfter: "2026-01-31T00:00:00.000Z",
    storageCleanupPending: true,
  });
});
