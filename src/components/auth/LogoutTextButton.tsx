"use client";

import { logoutCurrentUser } from "@/lib/actions/session";
import { clearLocalDocumentDraftsForLogout } from "@/lib/local-draft-continuity-client";

/**
 * 본문 안에서 쓰는 글자형 로그아웃(캔버스 AccountPassword "다른 계정으로 로그인" 링크 모양).
 * 계정 메뉴의 로그아웃과 같이 로컬 초안을 먼저 정리한다. 좁은 화면은 44px 터치 높이.
 */
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
        className="inline-flex h-11 items-center rounded-sm text-body text-secondary-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none md:h-auto md:text-ui"
      >
        {label}
      </button>
    </form>
  );
}
