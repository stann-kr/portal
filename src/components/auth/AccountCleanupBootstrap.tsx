"use client";

import { useEffect, useState } from "react";
import {
  isBrowserAccountOwnerTerminallyLocked,
  registerAccountCleanupToken,
  sweepAccountCleanupStatuses,
} from "@/lib/account-cleanup-client";

export const ACCOUNT_CLEANUP_RETRY_DELAYS_MS = [5_000, 30_000, 5 * 60_000] as const;

type AccountCleanupBootstrapProps = {
  /** 로그인 뒤에는 현재 owner만 조회하고, 로그인 전에는 기기의 등록 token을 모두 조회한다. */
  ownerId?: string;
  fetcher?: typeof fetch;
  onSignOut?: () => void | Promise<void>;
};

async function signOutDeletedAccount(): Promise<void> {
  const { signOut } = await import("next-auth/react");
  await signOut({ redirectTo: "/login" });
}

/** mount·online·focus에서 삭제 tombstone을 확인하고 성공한 owner 정리 뒤에만 sign-out한다. */
export function AccountCleanupBootstrap({
  ownerId,
  fetcher,
  onSignOut = signOutDeletedAccount,
}: AccountCleanupBootstrapProps) {
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let signedOut = false;
    let needsSignOut = false;
    let retryQueued = false;
    let retryAttempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearRetryTimer = () => {
      if (retryTimer === null) return;
      clearTimeout(retryTimer);
      retryTimer = null;
    };

    const scheduleRetry = (delayMs?: number) => {
      if (!active || signedOut) return;
      if (inFlight) {
        retryQueued = true;
        return;
      }
      clearRetryTimer();
      const retryDelay = delayMs ??
        ACCOUNT_CLEANUP_RETRY_DELAYS_MS[
          Math.min(retryAttempt, ACCOUNT_CLEANUP_RETRY_DELAYS_MS.length - 1)
        ]!;
      if (delayMs === undefined) retryAttempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void reconcile();
      }, retryDelay);
    };

    const attemptSignOut = async () => {
      try {
        await onSignOut();
        signedOut = true;
        needsSignOut = false;
        return true;
      } catch {
        if (active) {
          setAnnouncement(
            "이 기기 데이터는 정리했지만 로그아웃을 마치지 못했습니다. 다시 시도합니다.",
          );
        }
        return false;
      }
    };

    async function reconcile() {
      if (!active || signedOut) return;
      if (inFlight) {
        retryQueued = true;
        return;
      }
      inFlight = true;
      let shouldRetry = false;
      try {
        if (needsSignOut) {
          shouldRetry = !(await attemptSignOut());
          return;
        }
        let registrationFailed = false;
        const ownerTerminallyLocked = Boolean(
          ownerId && isBrowserAccountOwnerTerminallyLocked(ownerId),
        );
        if (ownerId && !ownerTerminallyLocked) {
          const registration = await registerAccountCleanupToken(ownerId, { fetcher });
          registrationFailed = !registration.ok;
        }
        const result = await sweepAccountCleanupStatuses({ ownerId, fetcher });
        if (!active) return;
        if (ownerId && result.shouldSignOut) {
          needsSignOut = true;
          setAnnouncement("삭제된 계정의 이 기기 데이터를 정리했습니다. 로그아웃합니다.");
          shouldRetry = !(await attemptSignOut());
          return;
        }
        if (!ownerId && result.cleanedOwners.length > 0) {
          setAnnouncement("삭제된 계정의 이 기기 데이터를 정리했습니다.");
        }
        if (
          registrationFailed ||
          result.storageUnavailable ||
          result.failedOwners.length > 0
        ) {
          shouldRetry = true;
          setAnnouncement(
            registrationFailed
              ? "이 기기의 계정 정리 등록을 마치지 못했습니다. 잠시 후 다시 시도합니다."
              : "계정 상태 또는 이 기기 데이터를 확인하지 못했습니다. 잠시 후 다시 시도합니다.",
          );
        } else {
          retryAttempt = 0;
          if (result.cleanedOwners.length === 0) setAnnouncement("");
        }
      } finally {
        inFlight = false;
        if (!active || signedOut) return;
        if (retryQueued) {
          retryQueued = false;
          scheduleRetry(0);
        } else if (shouldRetry) {
          scheduleRetry();
        }
      }
    }

    const handleRetry = () => {
      clearRetryTimer();
      if (inFlight) retryQueued = true;
      else void reconcile();
    };
    void reconcile();
    window.addEventListener("online", handleRetry);
    window.addEventListener("focus", handleRetry);
    return () => {
      active = false;
      clearRetryTimer();
      window.removeEventListener("online", handleRetry);
      window.removeEventListener("focus", handleRetry);
    };
  }, [fetcher, onSignOut, ownerId]);

  return (
    <p
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {announcement}
    </p>
  );
}
