"use client";

import { useState, useTransition } from "react";
import { useProgressRouter } from "@/components/app-shell/NavigationProgress";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { purgeTrashedGuidePage, restoreTrashedGuidePage } from "@/lib/actions/guide";
import { guidePagePath } from "@/lib/guide-content";

/** 가이드 휴지통 한 줄의 되살리기·영구 삭제(취소 우선 확인). */
export function GuideTrashActions({ pageId, title }: { pageId: string; title: string }) {
  const router = useProgressRouter();
  const purgeConfirm = useConfirmAction();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (kind: "restore" | "purge") => {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = kind === "restore" ? await restoreTrashedGuidePage(pageId) : await purgeTrashedGuidePage(pageId);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (kind === "restore") router.push(guidePagePath(pageId));
        router.refresh();
      } catch {
        setError("페이지 상태를 바꾼 결과를 확인하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  return (
    <div className="flex min-w-0 max-w-md flex-col items-start gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="max-md:h-11"
          disabled={isPending}
          pending={isPending && !purgeConfirm.isOpen}
          onClick={() => run("restore")}
          aria-label={`‘${title}’ 되살리기`}
        >
          되살리기
        </Button>
        <Button
          type="button"
          variant="destructive"
          className="max-md:h-11"
          disabled={isPending}
          aria-expanded={purgeConfirm.isOpen}
          onClick={(event) => purgeConfirm.request(event.currentTarget)}
          aria-label={`‘${title}’ 영구 삭제`}
        >
          영구 삭제
        </Button>
      </div>
      {purgeConfirm.isOpen ? (
        <ConfirmPanel
          confirm={purgeConfirm}
          message={`‘${title}’ 페이지와 이전 판을 영구 삭제합니다. 되돌릴 수 없습니다. 이 페이지에서 시작한 질문은 Q&A에 제목·인용과 함께 남습니다.`}
          confirmLabel="영구 삭제 확인"
          pendingLabel="삭제 중…"
          pending={isPending}
          onConfirm={() => run("purge")}
          className="w-full"
        />
      ) : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
