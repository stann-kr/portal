"use client";

import { useState, useTransition } from "react";
import { useProgressRouter } from "@/components/app-shell/NavigationProgress";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { restoreGuidePageRevision } from "@/lib/actions/guide";
import { guidePagePath } from "@/lib/guide-content";

/** 가이드 이전 판으로 되돌리기(취소 우선 확인). 지금 판은 이력에 남아 다시 되돌릴 수 있다. */
export function GuideRevisionRestoreButton({
  pageId,
  revisionId,
  baseVersion,
  label,
}: {
  pageId: string;
  revisionId: string;
  baseVersion: number;
  /** 화면 읽기용 판 이름(예: "3판"). */
  label: string;
}) {
  const router = useProgressRouter();
  const confirm = useConfirmAction();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="max-md:h-11"
        disabled={isPending}
        aria-expanded={confirm.isOpen}
        aria-label={`${label}으로 되돌리기`}
        onClick={(event) => {
          setError(null);
          confirm.request(event.currentTarget);
        }}
      >
        되돌리기
      </Button>
      {confirm.isOpen ? (
        <ConfirmPanel
          confirm={confirm}
          message={`${label}의 제목·본문으로 되돌릴까요? 지금 판은 이력에 남아 다시 되돌릴 수 있습니다.`}
          confirmLabel="되돌리기"
          pendingLabel="되돌리는 중…"
          pending={isPending}
          onConfirm={() => {
            startTransition(async () => {
              try {
                const result = await restoreGuidePageRevision(pageId, revisionId, baseVersion);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                router.push(guidePagePath(pageId));
                router.refresh();
              } catch {
                setError("되돌리지 못했습니다. 다시 시도해 주세요.");
              }
            });
          }}
        />
      ) : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
