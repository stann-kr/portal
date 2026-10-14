"use client";

import { logoutCurrentUser } from "@/lib/actions/session";
import { clearLocalDocumentDraftsForLogout } from "@/lib/local-draft-continuity-client";

/** 본문 안에서 쓰는 글자형 로그아웃. 사이드 레일 버튼과 같이 로컬 초안을 먼저 정리한다. */
export function LogoutTextButton({ ownerId, label }: { ownerId: string; label: string }) {
  return (
    <form
      action={logoutCurrentUser}
      onSubmit={() => {
        clearLocalDocumentDraftsForLogout(ownerId);
      }}
    >
      <button
        type="submit"
        className="rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {label}
      </button>
    </form>
  );
}
