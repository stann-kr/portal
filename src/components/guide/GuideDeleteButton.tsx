"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { useProgressRouter } from "@/components/app-shell/NavigationProgress";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { deleteGuidePage } from "@/lib/actions/guide";

/** 가이드 페이지 삭제(취소 우선 확인). 휴지통으로 옮기고 되살리면 질문 위치·열람 설정이 다시 이어진다. */
export function GuideDeleteButton({ pageId, version, title }: { pageId: string; version: number; title: string }) {
  const router = useProgressRouter();
  const confirm = useConfirmAction();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="ghost"
        aria-expanded={confirm.isOpen}
        disabled={isPending}
        onClick={(event) => {
          setError(null);
          confirm.request(event.currentTarget);
        }}
      >
        <Trash2 className="size-3.5" strokeWidth={1.6} aria-hidden="true" />
        삭제
      </Button>
      {confirm.isOpen ? (
        <ConfirmPanel
          confirm={confirm}
          message={`‘${title}’ 페이지를 휴지통으로 옮길까요? 학생에게 보이지 않게 되고, 가이드 휴지통에서 되살릴 수 있습니다.`}
          confirmLabel="페이지 삭제"
          pendingLabel="삭제 중…"
          pending={isPending}
          onConfirm={() => {
            startTransition(async () => {
              try {
                const result = await deleteGuidePage(pageId, version);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                router.push("/dashboard/guide");
                router.refresh();
              } catch {
                setError("페이지를 삭제하지 못했습니다. 다시 시도해 주세요.");
              }
            });
          }}
        />
      ) : null}
      {error ? <p role="alert" className="text-ui text-destructive">{error}</p> : null}
    </div>
  );
}
