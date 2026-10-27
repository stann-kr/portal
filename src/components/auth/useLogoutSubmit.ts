"use client";

import { useRef, useState, type FormEvent } from "react";
import { unstable_rethrow } from "next/navigation";
import { logoutCurrentUser } from "@/lib/actions/session";
import {
  acquireAccountLogoutLock,
  releaseAccountLogoutLock,
  type AccountLogoutLockHandle,
} from "@/lib/account-logout-lock";
import { postDocumentServerDraftDiscard } from "@/lib/document-server-draft-discard-api";
import { flushQueuedDocumentServerDraftDiscards } from "@/lib/document-server-draft-logout";
import { clearLocalDocumentDraftsForLogout } from "@/lib/local-draft-continuity-client";

export const LOGOUT_FAILED_MESSAGE = "로그아웃하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.";

async function flushServerDraftDiscards(ownerId: string): Promise<void> {
  try {
    if (window.navigator.onLine === false) return;
    await flushQueuedDocumentServerDraftDiscards({
      storage: window.localStorage,
      ownerId,
      // server action은 한 줄로 차례를 기다리므로, 응답 없는 폐기가 뒤의 로그아웃을 막지 않게 fetch로 보낸다.
      discard: (input, signal) => postDocumentServerDraftDiscard(input, { signal }),
    });
  } catch {
    // 저장소를 읽을 수 없거나 요청이 실패해도 로그아웃은 계속한다.
  }
}

function acquireLock(ownerId: string): AccountLogoutLockHandle | null {
  try {
    return acquireAccountLogoutLock(window.localStorage, ownerId);
  } catch {
    return null;
  }
}

function releaseLock(ownerId: string, handle: AccountLogoutLockHandle | null): void {
  try {
    releaseAccountLogoutLock(window.localStorage, ownerId, handle);
  } catch {
    // 풀지 못한 잠금은 만료로 풀린다.
  }
}

/** 로그아웃 action의 redirect 같은 Next.js 이동 신호면 true(실패가 아니라 이동 중이다). */
function isNavigationSignal(error: unknown): boolean {
  try {
    unstable_rethrow(error);
    return false;
  } catch {
    return true;
  }
}

/**
 * 로그아웃 form의 onSubmit. 먼저 같은 계정의 모든 탭에 로그아웃 잠금을 알려 서버 초안 저장을 멈추고,
 * 이 계정의 서버 초안 폐기 요청을 보낸 뒤(최대 3초) 로그아웃 action을 직접 부르고, 로그아웃이 확인되면 로컬 초안을 지운다.
 * action이 실패하면 로컬 초안은 그대로 두고 잠금을 풀며(다른 탭이 다시 저장한다) 버튼을 다시 누를 수 있게 하고 오류를 보인다.
 * form의 action은 JavaScript 없이 제출할 때만 쓰인다.
 */
export function useLogoutSubmit(ownerId: string) {
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    void (async () => {
      // 폐기를 계산·전송하기 전에 잠근다. 그래야 다른 탭이 폐기 직후 초안을 다시 저장하지 못한다.
      const lock = acquireLock(ownerId);
      await flushServerDraftDiscards(ownerId);
      try {
        await logoutCurrentUser();
        clearLocalDocumentDraftsForLogout(ownerId);
      } catch (failure) {
        // 로그아웃이 확인된 뒤(redirect 신호)에만 이 기기의 초안을 지운다. 실패하면 초안과 열린 편집기를 그대로 둔다.
        if (isNavigationSignal(failure)) {
          clearLocalDocumentDraftsForLogout(ownerId);
          return;
        }
        releaseLock(ownerId, lock);
        pendingRef.current = false;
        setPending(false);
        setError(LOGOUT_FAILED_MESSAGE);
      }
    })();
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    start();
  };

  return { onSubmit, start, pending, error, clearError: () => setError(null) };
}
