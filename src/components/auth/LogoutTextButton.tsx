"use client";

import { logoutCurrentUser } from "@/lib/actions/session";
import { useLogoutSubmit } from "./useLogoutSubmit";

/**
 * 본문 안에서 쓰는 글자형 로그아웃(캔버스 AccountPassword "다른 계정으로 로그인" 링크 모양).
 * 계정 메뉴의 로그아웃과 같이 서버 초안 폐기 요청을 보내고 로컬 초안을 정리한다. 좁은 화면은 44px 터치 높이.
 */
export function LogoutTextButton({ ownerId, label }: { ownerId: string; label: string }) {
  const { onSubmit, pending } = useLogoutSubmit(ownerId);
  return (
    <form action={logoutCurrentUser} onSubmit={onSubmit}>
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        className="inline-flex h-11 items-center rounded-sm text-body text-secondary-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 motion-reduce:transition-none md:h-auto md:text-ui"
      >
        {label}
      </button>
    </form>
  );
}
