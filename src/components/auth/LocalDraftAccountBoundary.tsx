"use client";

import { useEffect } from "react";
import { clearLocalDocumentDraftsFromOtherOwners } from "@/lib/local-draft-continuity-client";

/** 인증 계정이 바뀔 때 공유 기기에 남은 다른 계정의 문서 초안을 정리한다. */
export function LocalDraftAccountBoundary({ ownerId }: { ownerId: string }) {
  useEffect(() => {
    clearLocalDocumentDraftsFromOtherOwners(ownerId);
  }, [ownerId]);

  return null;
}
