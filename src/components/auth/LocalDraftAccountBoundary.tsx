"use client";

import { useEffect } from "react";
import { AccountCleanupBootstrap } from "@/components/auth/AccountCleanupBootstrap";
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
    clearLocalDocumentDraftsFromOtherOwners(ownerId);
  }, [ownerId]);

  return role === "student"
    ? <AccountCleanupBootstrap ownerId={ownerId} />
    : null;
}
