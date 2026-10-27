"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/** 인증 화면 입력 라벨: 좁은 화면 14px, 넓은 화면 13px, 글자 2. */
export const AUTH_LABEL_CLASS = "text-body text-secondary-foreground md:text-ui";
/** 인증 화면 입력: 좁은 화면 48 · r8 · 16px, 넓은 화면 40 · r6 · 14px(캔버스 Login·MobileLogin). */
export const AUTH_INPUT_CLASS = "h-12 px-3.5 md:h-10 md:px-3";
/** 인증 화면 주 버튼: 좁은 화면 48 · r8 · 15px, 넓은 화면 40 · r6 · 14px, 위 8px 더 띄움. */
export const AUTH_SUBMIT_CLASS = "mt-2 w-full md:h-10 md:rounded-md md:text-body";

/** 비밀번호 확인 동안 중복 제출을 막고 진행 상태를 알린다. */
export function LoginSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="touch" className={AUTH_SUBMIT_CLASS} disabled={pending} aria-busy={pending}>
      {pending ? "로그인 중..." : "로그인"}
    </Button>
  );
}
