"use client";

import { useEffect } from "react";
import { AccountCleanupBootstrap } from "@/components/auth/AccountCleanupBootstrap";
import { isBrowserAccountOwnerTerminallyLocked } from "@/lib/account-cleanup-client";
import { unlockCollabOwner } from "@/lib/collab/client/local-store";
import { clearLocalDocumentDraftsFromOtherOwners } from "@/lib/local-draft-continuity-client";

/** 인증 계정이 바뀔 때 공유 기기에 남은 다른 계정의 문서 초안을 정리한다. */
export function LocalDraftAccountBoundary({
  ownerId,
  role,
}: {
  ownerId: string;
  role: "admin" | "student";
}) {
  useEffect(() => {
    // 같은 owner로 새로 로그인하면 로그아웃 때 건 공동 편집 잠금을 푼다(삭제된 계정은 terminal lock으로 계속 막는다).
    try {
      if (!isBrowserAccountOwnerTerminallyLocked(ownerId)) unlockCollabOwner(ownerId);
    } catch {
      // 풀지 못하면 이 기기 보관 없이 서버 연결로만 편집한다.
    }
    void clearLocalDocumentDraftsFromOtherOwners(ownerId);
  }, [ownerId]);

  return role === "student"
    ? <AccountCleanupBootstrap ownerId={ownerId} />
    : null;
}
