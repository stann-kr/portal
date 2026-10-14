"use client";

import { PasswordChangeForm } from "@/components/auth/PasswordChangeControl";
import { logoutCurrentUser } from "@/lib/actions/session";
import { clearLocalDocumentDraftsForLogout } from "@/lib/local-draft-continuity-client";

/**
 * 임시 비밀번호로 로그인한 뒤의 필수 비밀번호 설정.
 * 저장하면 새 비밀번호로 다시 발급된 로그인으로 포털을 처음부터 연다.
 */
export function RequiredPasswordChange({ ownerId }: { ownerId: string }) {
  return (
    <div className="space-y-5">
      {/* 전체 이동으로 middleware와 layout이 새 session cookie를 처음부터 읽게 한다. */}
      <PasswordChangeForm variant="required" onDone={() => window.location.assign("/dashboard")} />
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
          다른 계정으로 로그인
        </button>
      </form>
    </div>
  );
}
