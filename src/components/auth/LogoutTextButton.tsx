"use client";

import { ButtonSpinner } from "@/components/ui/button";
import { logoutCurrentUser } from "@/lib/actions/session";
import { useLogoutSubmit } from "./useLogoutSubmit";

/**
 * 본문 안에서 쓰는 글자형 로그아웃(캔버스 AccountPassword "다른 계정으로 로그인" 링크 모양).
 * 계정 메뉴의 로그아웃과 같이 서버 초안 폐기 요청을 보내고 로컬 초안을 정리한다. 좁은 화면은 44px 터치 높이.
 * 기다리는 동안 회전 표시를 앞에 두고, 실패하면 아래에 오류를 보이며 다시 누를 수 있다.
 */
export function LogoutTextButton({ ownerId, label }: { ownerId: string; label: string }) {
  const { onSubmit, pending, error } = useLogoutSubmit(ownerId);
  return (
    <form action={logoutCurrentUser} onSubmit={onSubmit} className="flex flex-col items-start gap-1">
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
        className="inline-flex h-11 items-center gap-1.5 rounded-sm text-body text-secondary-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 motion-reduce:transition-none md:h-auto md:text-ui"
      >
        {pending ? <ButtonSpinner /> : null}
        {label}
      </button>
      {error ? (
        <p role="alert" className="text-ui text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
