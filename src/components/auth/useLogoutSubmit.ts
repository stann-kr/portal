"use client";

import { useRef, useState, type FormEvent } from "react";
import { discardDocumentServerDraft } from "@/lib/actions/documentDrafts";
import { flushQueuedDocumentServerDraftDiscards } from "@/lib/document-server-draft-logout";
import { clearLocalDocumentDraftsForLogout } from "@/lib/local-draft-continuity-client";

async function flushServerDraftDiscards(ownerId: string): Promise<void> {
  try {
    if (window.navigator.onLine === false) return;
    await flushQueuedDocumentServerDraftDiscards({
      storage: window.localStorage,
      ownerId,
      discard: discardDocumentServerDraft,
    });
  } catch {
    // 저장소를 읽을 수 없거나 요청이 실패해도 로그아웃은 계속한다.
  }
}

/**
 * 로그아웃 form의 onSubmit. 첫 제출은 멈추고 이 계정의 서버 초안 폐기 요청을 보낸 뒤(최대 3초)
 * 다시 제출한다. 다시 제출할 때 로컬 초안을 지우고 server action이 로그아웃한다.
 * 등록 직후 로그아웃해도 이미 게시한 글의 계정 작성본이 남지 않는다.
 */
export function useLogoutSubmit(ownerId: string) {
  const flushedRef = useRef(false);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (flushedRef.current) {
      flushedRef.current = false;
      clearLocalDocumentDraftsForLogout(ownerId);
      return;
    }
    event.preventDefault();
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    const form = event.currentTarget;
    void flushServerDraftDiscards(ownerId).then(() => {
      flushedRef.current = true;
      form.requestSubmit();
    });
  };

  return { onSubmit, pending };
}
