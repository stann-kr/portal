/**
 * @file src/components/student-portal/AccountDraftNotice.tsx
 * @description 과제 글 계정 임시 저장의 기기 간 안내(캔버스 CowriteDrafts ④).
 * 이 기기에도 올리지 않은 다른 입력이 있을 때만 form 위에 고르는 줄을 보이고, 고르지 않은 쪽은 보관본 줄로 되살릴 수 있다.
 */
"use client";

import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UseAccountDraftSyncResult } from "@/lib/hooks/useAccountDraftSync";
import { formatKstClock, formatKstMonthDayTime } from "@/lib/kst-format";

export function AccountDraftNotice({
  sync,
  disabled = false,
}: {
  sync: Pick<UseAccountDraftSyncResult, "conflict" | "chooseAccountCopy" | "chooseDeviceCopy" | "alternate" | "restoreAlternate" | "dismissAlternate">;
  disabled?: boolean;
}) {
  const { conflict, alternate } = sync;
  if (conflict) {
    return (
      <div role="status" className="flex flex-col gap-2.5 rounded-lg border border-border bg-sidebar p-3 text-ui">
        <p>
          다른 기기에서 <span className="font-mono">{formatKstClock(conflict.at)}</span>에 쓴 내용이 있어요. 이 기기의 내용과 다릅니다.
        </p>
        {conflict.preview ? (
          <p className="break-words border-l-2 border-border pl-2.5 text-secondary-foreground">“{conflict.preview}”</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" className="max-md:h-11" onClick={sync.chooseAccountCopy} disabled={disabled}>
            그 내용으로 이어 쓰기
          </Button>
          <Button type="button" size="sm" variant="outline" className="max-md:h-11" onClick={sync.chooseDeviceCopy} disabled={disabled}>
            이 기기 내용 유지
          </Button>
        </div>
      </div>
    );
  }
  if (!alternate) return null;
  const label = alternate.from === "device" ? "이 기기에서 쓰던" : "다른 기기에서 쓴";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-secondary-foreground">
      <p className="inline-flex min-w-0 items-start gap-1.5">
        <Archive className="mt-px size-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
        <span className="min-w-0 break-words">
          고르지 않은 {label} 내용(<span className="font-mono">{formatKstMonthDayTime(alternate.at)}</span>)을 이 기기에 보관했습니다
          {alternate.preview ? ` · “${alternate.preview}”` : ""}
        </span>
      </p>
      <span className="flex gap-2">
        <Button type="button" size="sm" variant="outline" className="max-md:h-11" onClick={sync.restoreAlternate} disabled={disabled}>
          되살리기
        </Button>
        <Button type="button" size="sm" variant="ghost" className="max-md:h-11" onClick={sync.dismissAlternate} disabled={disabled}>
          버리기
        </Button>
      </span>
    </div>
  );
}

/** 충돌 안내·보관본에 보일 앞부분(약 40자). */
export function draftPreviewText(...parts: Array<string | null | undefined>): string {
  const text = parts.map((part) => (part ?? "").replace(/\s+/gu, " ").trim()).find((part) => part.length > 0) ?? "";
  return text.length > 40 ? `${text.slice(0, 40).trimEnd()}…` : text;
}
