import type {
  DeleteStudentAccountFailureReason,
  DeleteStudentAccountResult,
} from "@/lib/account-privacy-atomic";
import { ACCOUNT_CLEANUP_TOKEN_DIGEST_PATTERN } from "@/lib/account-cleanup-token";
import { ACCOUNT_DELETION_CONFIRMATION } from "@/lib/account-privacy-policy";
import { parseCreationOperationId } from "@/lib/creation-operation";

export type DeleteOwnAccountInput = {
  password: string;
  confirmation: string;
  operationId: string;
  cleanupTokenDigest: string;
  useEphemeralCleanupDigest: boolean;
};

export type DeleteOwnAccountResult =
  | {
      success: true;
      replayed: boolean;
      rawIdEraseAfter: string;
      storageCleanupPending: true;
    }
  | {
      success: false;
      error: string;
      reason?:
        | DeleteStudentAccountFailureReason
        | "INVALID_INPUT"
        | "PASSWORD_MISMATCH";
    };

export type DeleteOwnAccountDependencies = {
  requireSession: () => Promise<{
    user: { id: string; role: "admin" | "student" };
  }>;
  loadProfileCredentials: (ownerId: string) => Promise<{
    role: "admin" | "student";
    passwordHash: string | null;
  } | null>;
  comparePassword: (password: string, passwordHash: string) => Promise<boolean>;
  enqueueExpiredMedia: (now: Date) => Promise<void>;
  deleteAccount: (input: {
    actorId: string;
    operationId: string;
    initiatingCleanupTokenDigest: string;
    useEphemeralCleanupDigest?: boolean;
    now: Date;
  }) => Promise<DeleteStudentAccountResult>;
  processStorageCleanup: () => Promise<unknown>;
  now: () => Date;
};

function deletionFailureMessage(reason: DeleteStudentAccountFailureReason): string {
  switch (reason) {
    case "INVALID_OPERATION_ID":
    case "INVALID_TOKEN_DIGEST":
      return "계정 삭제 요청 형식이 올바르지 않습니다. 창을 닫고 다시 시도해 주세요.";
    case "STUDENT_NOT_FOUND":
      return "활성 학생 계정을 찾을 수 없습니다.";
    case "ADMIN_FORBIDDEN":
      return "관리자 계정은 이 화면에서 삭제할 수 없습니다.";
    case "CLEANUP_TOKEN_NOT_ACTIVE":
      return "이 기기의 정리 신호를 등록하지 못했습니다. 온라인 상태에서 다시 시도해 주세요.";
    case "OPERATION_PAYLOAD_CONFLICT":
      return "같은 삭제 요청 식별자가 다른 내용으로 이미 사용되었습니다. 창을 닫고 다시 시도해 주세요.";
    case "ACTIVE_MEDIA_SEAL":
      return "파일 업로드 완료 처리가 진행 중입니다. 잠시 기다린 뒤 다시 시도해 주세요.";
    case "CONCURRENT_MUTATION":
      return "계정 데이터가 동시에 변경되었습니다. 잠시 뒤 다시 시도해 주세요.";
  }
}

/** Server Action의 인증·비밀번호·원자 삭제 orchestration을 주입 가능한 경계로 묶는다. */
export async function executeDeleteOwnAccount(
  input: DeleteOwnAccountInput,
  dependencies: DeleteOwnAccountDependencies,
): Promise<DeleteOwnAccountResult> {
  let session: Awaited<ReturnType<DeleteOwnAccountDependencies["requireSession"]>>;
  try {
    session = await dependencies.requireSession();
  } catch {
    return { success: false, error: "로그인이 만료되었습니다." };
  }

  const password = input?.password ?? "";
  const operationId = parseCreationOperationId(input?.operationId);
  if (
    session.user.role !== "student" ||
    input?.confirmation !== ACCOUNT_DELETION_CONFIRMATION ||
    password.length < 1 ||
    password.length > 256 ||
    !operationId ||
    typeof input?.useEphemeralCleanupDigest !== "boolean" ||
    !ACCOUNT_CLEANUP_TOKEN_DIGEST_PATTERN.test(input?.cleanupTokenDigest ?? "")
  ) {
    return {
      success: false,
      reason: "INVALID_INPUT",
      error: `확인 문구 “${ACCOUNT_DELETION_CONFIRMATION}”와 현재 비밀번호를 정확히 입력해 주세요.`,
    };
  }

  const profile = await dependencies.loadProfileCredentials(session.user.id);
  if (!profile || profile.role !== "student" || !profile.passwordHash) {
    return { success: false, error: "활성 학생 계정을 찾을 수 없습니다." };
  }

  let passwordMatches = false;
  try {
    passwordMatches = await dependencies.comparePassword(
      password,
      profile.passwordHash,
    );
  } catch {
    return {
      success: false,
      error: "비밀번호를 확인하지 못했습니다. 다시 시도해 주세요.",
    };
  }
  if (!passwordMatches) {
    return {
      success: false,
      reason: "PASSWORD_MISMATCH",
      error: "현재 비밀번호가 올바르지 않습니다.",
    };
  }

  const now = dependencies.now();
  let result: DeleteStudentAccountResult;
  try {
    // 같은 시각으로 expiry 수렴과 삭제 precondition을 평가해 lease 경계를 건너뛰지 않는다.
    await dependencies.enqueueExpiredMedia(now);
    result = await dependencies.deleteAccount({
      actorId: session.user.id,
      operationId,
      initiatingCleanupTokenDigest: input.cleanupTokenDigest,
      useEphemeralCleanupDigest: input.useEphemeralCleanupDigest,
      now,
    });
  } catch {
    return {
      success: false,
      error: "계정 삭제 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.",
    };
  }

  if (!result.ok) {
    return {
      success: false,
      reason: result.reason,
      error: deletionFailureMessage(result.reason),
    };
  }

  // DB 완료 뒤 저장소 retry가 실패해도 원자 삭제 성공을 실패로 바꾸지 않는다.
  try {
    await dependencies.processStorageCleanup();
  } catch {
    // durable outbox와 운영 runner가 계속 수렴한다.
  }
  return {
    success: true,
    replayed: result.status === "REPLAYED",
    rawIdEraseAfter: result.rawIdEraseAfter.toISOString(),
    storageCleanupPending: true,
  };
}
