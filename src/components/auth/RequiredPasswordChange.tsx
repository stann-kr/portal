"use client";

import { LogoutTextButton } from "@/components/auth/LogoutTextButton";
import { PasswordChangeForm } from "@/components/auth/PasswordChangeControl";

/**
 * 임시 비밀번호로 로그인한 뒤의 필수 비밀번호 설정.
 * 저장하면 새 비밀번호로 다시 발급된 로그인으로 바로 포탈을 처음부터 연다.
 */
export function RequiredPasswordChange({ ownerId }: { ownerId: string }) {
  return (
    <div className="flex flex-col gap-7">
      {/* 전체 이동으로 proxy와 layout이 새 session cookie를 처음부터 읽게 한다. */}
      <PasswordChangeForm variant="required" onDone={() => window.location.assign(new URL("/dashboard", window.location.origin))} />
      <div className="md:pt-4">
        <LogoutTextButton ownerId={ownerId} label="다른 계정으로 로그인" />
      </div>
    </div>
  );
}
