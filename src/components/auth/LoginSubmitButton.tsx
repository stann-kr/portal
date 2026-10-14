"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/** 비밀번호 확인 동안 중복 제출을 막고 진행 상태를 알린다. */
export function LoginSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending} aria-busy={pending}>
      {pending ? "로그인 중..." : "로그인"}
    </Button>
  );
}
