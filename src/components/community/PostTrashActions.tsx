"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { purgePost, restorePost } from "@/lib/actions/posts";
import { createCreationOperationId } from "@/lib/creation-operation";
import { useHasPassed } from "@/lib/hooks/useHasPassed";

const RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;

export function PostTrashActions({
  postId,
  version,
  deletedAt,
  canRestore,
  canPurge,
  returnTo,
}: {
  postId: string;
  version: number;
  deletedAt: string;
  canRestore: boolean;
  canPurge: boolean;
  returnTo: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const operations = useRef<{ key: string; restore: string; purge: string } | null>(null);
  // 화면이 열린 채 보관 기간을 넘겨도 버튼이 바뀐다. 실제 영구 삭제 가능 여부는 서버가 다시 확인한다.
  const expired = useHasPassed(new Date(deletedAt).getTime() + RETENTION_MILLISECONDS);

  const purgeConfirm = useConfirmAction();

  const run = (kind: "restore" | "purge") => {
    if (isPending) return;
    const requestKey = JSON.stringify([postId, version]);
    if (operations.current?.key !== requestKey) {
      operations.current = { key: requestKey, restore: createCreationOperationId(), purge: createCreationOperationId() };
    }
    const operationId = operations.current[kind];
    setError(null);
    startTransition(async () => {
      try {
        const result =
          kind === "restore"
            ? await restorePost(postId, operationId, version)
            : await purgePost(postId, operationId, version);
        if (!result.success) {
          setError(result.error ?? "게시물 상태를 변경하지 못했습니다.");
          return;
        }
        setError(null);
        if (kind === "purge") router.push(returnTo);
        else router.refresh();
      } catch {
        setError("게시물 상태를 변경하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canRestore && !expired ? (
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={isPending}
            onClick={() => run("restore")}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            게시물 복원
          </Button>
        ) : null}
        {canPurge && expired ? (
          <Button
            type="button"
            className="gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={isPending}
            aria-expanded={purgeConfirm.isOpen}
            onClick={(event) => purgeConfirm.request(event.currentTarget)}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            영구 삭제
          </Button>
        ) : null}
      </div>
      {purgeConfirm.isOpen ? (
        <ConfirmPanel
          confirm={purgeConfirm}
          message="게시물 본문, 댓글, 모든 revision을 영구 삭제합니다. 되돌릴 수 없습니다."
          confirmLabel="영구 삭제 확인"
          pendingLabel="삭제 중..."
          pending={isPending}
          onConfirm={() => run("purge")}
          className="max-w-md"
        />
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
