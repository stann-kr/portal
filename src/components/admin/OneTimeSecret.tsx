"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 발급 직후 한 번만 보여 주는 값(임시 비밀번호, 가입 링크, 구독 URL)과 복사 버튼(AdminStudentCreated 보드).
 * 값 칸 아래에 다시 볼 수 없다는 위험 안내를 두고, 자동 복사가 막힌 환경에서는 값을 직접 선택하도록 안내한다.
 */
export function OneTimeSecret({
  value,
  notice,
  label,
  href,
}: {
  value: string;
  notice: string;
  /** 값 칸 위 이름(예: 가입 링크). */
  label?: string;
  /** 값이 열 수 있는 주소이면 값 칸을 링크로 만든다(구독 URL). */
  href?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {label ? <span className="text-ui font-medium text-secondary-foreground">{label}</span> : null}
        <div className="flex gap-2">
          <code className="flex h-11 min-w-0 flex-1 select-all items-center overflow-x-auto whitespace-nowrap rounded-touch border border-border bg-sidebar px-3 font-mono text-xs text-foreground md:h-10 md:rounded-md">
            {href ? (
              <a href={href} className="underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {value}
              </a>
            ) : value}
          </code>
          <Button type="button" className="h-11 shrink-0 rounded-touch px-3.5 md:h-10 md:rounded-md" onClick={copy}>
            {copied ? (
              <Check className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
            )}
            {copied ? "복사됨" : "복사"}
          </Button>
        </div>
      </div>
      <p className="flex gap-2 rounded-touch bg-destructive-muted px-3.5 py-3 text-ui text-destructive">
        <TriangleAlert className="mt-[3px] size-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
        {notice}
      </p>
      {copyFailed ? (
        <p role="alert" className="text-xs text-destructive">
          자동 복사에 실패했습니다. 위 값을 직접 선택해 복사해 주세요.
        </p>
      ) : null}
    </div>
  );
}

/**
 * 학생 상세 계정 줄(AdminStudentDetail 보드): 104px 이름과 값. 넓은 화면 32px·13px, 좁은 화면 36px·14px.
 * 계정 조작 컴포넌트가 각자 자기 상태 줄을 그리고, 학생 상세는 `order`로 줄을 먼저 모아 보인다.
 */
export function AccountStatusRow({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("flex items-start py-[7px] text-body md:py-1.5 md:text-ui", className)}>
      <span className="w-26 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-foreground">{children}</span>
    </p>
  );
}

/** 계정 조작 버튼: 줄 너비를 채우는 outline 버튼(넓은 화면 32px·r6, 좁은 화면 44px·r8·14px). */
export const ACCOUNT_ACTION_BUTTON_CLASS = "h-11 w-full rounded-touch text-body md:h-8 md:rounded-md md:text-ui";
