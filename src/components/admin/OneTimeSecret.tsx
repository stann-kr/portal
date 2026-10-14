"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 발급 직후 한 번만 보여 주는 값(임시 비밀번호, 가입 링크)과 복사 버튼.
 * 자동 복사가 막힌 환경에서는 값을 직접 선택할 수 있게 안내한다.
 */
export function OneTimeSecret({ value, notice }: { value: string; notice: string }) {
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
    <div className="space-y-2">
      <p className="text-xs text-destructive">{notice}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all break-all font-mono text-sm text-foreground">{value}</code>
        <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={copy}>
          {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          {copied ? "복사됨" : "복사"}
        </Button>
      </div>
      {copyFailed ? (
        <p role="alert" className="text-xs text-destructive">
          자동 복사에 실패했습니다. 위 값을 직접 선택해 복사해 주세요.
        </p>
      ) : null}
    </div>
  );
}
