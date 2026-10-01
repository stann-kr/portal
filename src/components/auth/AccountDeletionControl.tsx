"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  clearAuthenticatedDeletedAccountLocalState,
  clearDeletedAccountLocalState,
  createEphemeralAccountCleanupTokenDigest,
  registerAccountCleanupToken,
  requestAccountCleanupStatus,
} from "@/lib/account-cleanup-client";
import { deleteOwnAccount } from "@/lib/actions/accountPrivacy";
import { ACCOUNT_DELETION_CONFIRMATION } from "@/lib/account-privacy-policy";

type RegistrationState =
  | { status: "idle" | "pending" }
  | { status: "ready"; tokenDigest: string; persistent: boolean }
  | { status: "error" };

type AccountDeletionControlDependencies = {
  registerPersistentToken: typeof registerAccountCleanupToken;
  createEphemeralToken: typeof createEphemeralAccountCleanupTokenDigest;
  requestCleanupStatus: typeof requestAccountCleanupStatus;
  deleteAccount: typeof deleteOwnAccount;
  clearLocalState: typeof clearDeletedAccountLocalState;
  clearAuthenticatedLocalState:
    typeof clearAuthenticatedDeletedAccountLocalState;
  finishSession: (target: string) => Promise<void>;
  createOperationId: () => string;
};

function createOperationId(): string {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("안전한 삭제 요청 식별자를 만들 수 없습니다.");
  }
  return crypto.randomUUID();
}

async function finishDeletedAccountSession(target: string): Promise<void> {
  try {
    const { signOut } = await import("next-auth/react");
    await signOut({ redirectTo: target });
  } catch {
    window.location.assign(target);
  }
}

const DEFAULT_ACCOUNT_DELETION_DEPENDENCIES: AccountDeletionControlDependencies = {
  registerPersistentToken: registerAccountCleanupToken,
  createEphemeralToken: createEphemeralAccountCleanupTokenDigest,
  requestCleanupStatus: requestAccountCleanupStatus,
  deleteAccount: deleteOwnAccount,
  clearLocalState: clearDeletedAccountLocalState,
  clearAuthenticatedLocalState: clearAuthenticatedDeletedAccountLocalState,
  finishSession: finishDeletedAccountSession,
  createOperationId,
};

export function AccountDeletionControl({ ownerId }: { ownerId: string }) {
  return (
    <AccountDeletionControlImpl
      ownerId={ownerId}
      dependencies={DEFAULT_ACCOUNT_DELETION_DEPENDENCIES}
    />
  );
}

export function AccountDeletionControlImpl({
  ownerId,
  dependencies,
  initialFormValues,
}: {
  ownerId: string;
  dependencies: AccountDeletionControlDependencies;
  /** DOM 격리 테스트에서만 초기 controlled value를 주입한다. */
  initialFormValues?: { password: string; confirmation: string };
}) {
  const statusId = useId();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState(initialFormValues?.password ?? "");
  const [confirmation, setConfirmation] = useState(
    initialFormValues?.confirmation ?? "",
  );
  const [operationId, setOperationId] = useState("");
  const [registration, setRegistration] = useState<RegistrationState>({
    status: "idle",
  });
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setRegistration({ status: "pending" });
    setMessage("이 기기의 계정 삭제 정리 신호를 등록하고 있습니다.");
    void dependencies.registerPersistentToken(ownerId).then(async (persistentResult) => {
      if (!active) return;
      const persistent = persistentResult.ok;
      // 등록 quota·일시 오류가 self-delete 자체를 막지 않게 한다. memory-only
      // digest는 비밀번호 검증 뒤 삭제 transaction의 job에만 기록된다.
      const result = persistentResult.ok
        ? persistentResult
        : dependencies.createEphemeralToken();
      if (!active) return;
      if (result.ok) {
        setRegistration({
          status: "ready",
          tokenDigest: result.tokenDigest,
          persistent,
        });
        setMessage(
          persistent
            ? "이 기기의 정리 신호를 등록했습니다."
            : "지속 정리 신호를 등록하지 못해 이 화면에만 유효한 삭제 신호를 준비했습니다.",
        );
      } else {
        setRegistration({ status: "error" });
        setMessage("이 기기의 정리 신호를 등록하지 못했습니다. 연결을 확인하고 다시 열어 주세요.");
      }
    });
    return () => {
      active = false;
    };
  }, [dependencies, open, ownerId]);

  useEffect(() => {
    if (confirming) passwordRef.current?.focus();
  }, [confirming]);

  const reset = () => {
    setConfirming(false);
    setPassword("");
    setConfirmation("");
    setOperationId("");
    setRegistration({ status: "idle" });
    setMessage("");
  };

  const beginConfirmation = () => {
    if (registration.status !== "ready") return;
    try {
      setOperationId(dependencies.createOperationId());
      setConfirming(true);
      setMessage("현재 비밀번호와 확인 문구를 입력해야 삭제 요청을 실행합니다.");
    } catch {
      setMessage("안전한 삭제 요청을 만들지 못했습니다. 브라우저를 새로고침해 주세요.");
    }
  };

  const submit = () => {
    if (registration.status !== "ready" || !operationId) return;
    setMessage("계정 데이터 삭제를 요청하고 있습니다. 창을 닫지 마세요.");
    startTransition(async () => {
      const finishDeletion = async () => {
        const localCleanup = registration.persistent
          ? dependencies.clearLocalState(ownerId, registration.tokenDigest)
          : dependencies.clearAuthenticatedLocalState(ownerId);
        const localCleanupSucceeded = localCleanup.success;
        const target = localCleanupSucceeded
          ? "/login?accountDeleted=1"
          : registration.persistent
            ? "/login?accountDeleted=1&deviceCleanup=pending"
            : "/login?accountDeleted=1&deviceCleanup=manual";
        setMessage(
          localCleanupSucceeded
            ? "포털 원문과 이 기기에 확인된 계정 데이터를 삭제했습니다. 관리되는 첨부 파일 정리는 백그라운드에서 재시도하며 로그아웃합니다."
            : registration.persistent
              ? "포털 원문을 삭제했습니다. 이 기기 정리는 로그인 화면에서 다시 시도하며 로그아웃합니다."
              : "포털 원문을 삭제했습니다. 브라우저 저장소에 접근할 수 없어 로그인 화면에서 수동 기기 정리를 안내합니다.",
        );
        await dependencies.finishSession(target);
      };

      let result: Awaited<ReturnType<typeof deleteOwnAccount>>;
      try {
        result = await dependencies.deleteAccount({
          password,
          confirmation,
          operationId,
          cleanupTokenDigest: registration.tokenDigest,
          useEphemeralCleanupDigest: !registration.persistent,
        });
      } catch {
        const status = await dependencies.requestCleanupStatus(
          registration.tokenDigest,
        );
        if (status.ok && status.status === "DELETED") {
          await finishDeletion();
          return;
        }
        setMessage(
          "삭제 요청 결과를 확인하지 못했습니다. 같은 삭제 버튼으로 동일 요청을 다시 확인해 주세요.",
        );
        return;
      }
      if (!result.success) {
        if (!result.reason) {
          const status = await dependencies.requestCleanupStatus(
            registration.tokenDigest,
          );
          if (status.ok && status.status === "DELETED") {
            await finishDeletion();
            return;
          }
        }
        setMessage(result.error);
        return;
      }
      await finishDeletion();
    });
  };

  const ready = registration.status === "ready";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isPending) return;
        setOpen(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label="계정 삭제"
          title="계정 삭제"
        >
          <UserX className="size-4" aria-hidden="true" />
        </button>
      </DialogTrigger>
      <DialogContent dismissible={!isPending} className="max-w-md">
        <DialogHeader>
          <DialogTitle>계정을 삭제할까요?</DialogTitle>
          <DialogDescription>
            계정과 포털의 학습 기록, 문서, 댓글과 Q&A 원문은 복구할 수 없습니다.
            관리되는 첨부 파일은 비동기 저장소 정리 작업에 등록됩니다.
          </DialogDescription>
        </DialogHeader>

        {!confirming ? (
          <div className="space-y-4">
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>현재 세션과 이후의 모든 요청이 즉시 차단됩니다.</li>
              <li>정리 신호가 등록된 다른 기기는 다음 온라인 연결 때 해당 계정 초안을 삭제합니다.</li>
              <li>부활 방지 식별자는 최대 30일 보존 대상으로 분류됩니다.</li>
            </ul>
            <Button
              type="button"
              variant="outline"
              className="w-full text-destructive"
              disabled={!ready}
              aria-describedby={statusId}
              onClick={beginConfirmation}
            >
              {registration.status === "pending" ? "기기 확인 중" : "삭제 확인 단계로 이동"}
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="space-y-2">
              <label htmlFor={`${statusId}-password`} className="text-sm font-medium">
                현재 비밀번호
              </label>
              <Input
                ref={passwordRef}
                id={`${statusId}-password`}
                type="password"
                autoComplete="current-password"
                value={password}
                disabled={isPending}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor={`${statusId}-confirmation`} className="text-sm font-medium">
                확인을 위해 “{ACCOUNT_DELETION_CONFIRMATION}” 입력
              </label>
              <Input
                id={`${statusId}-confirmation`}
                type="text"
                autoComplete="off"
                value={confirmation}
                disabled={isPending}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={isPending}
                onClick={() => setConfirming(false)}
              >
                이전
              </Button>
              <Button
                type="submit"
                className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={
                  isPending ||
                  !password ||
                  confirmation !== ACCOUNT_DELETION_CONFIRMATION
                }
                aria-describedby={statusId}
              >
                {isPending ? "삭제 중" : "계정 영구 삭제"}
              </Button>
            </div>
          </form>
        )}

        <p
          id={statusId}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="text-xs text-muted-foreground"
        >
          {message}
        </p>
      </DialogContent>
    </Dialog>
  );
}
