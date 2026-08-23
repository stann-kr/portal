"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { purgePost, restorePost } from "@/lib/actions/posts";
import { createCreationOperationId } from "@/lib/creation-operation";

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
  const [restoreOperationId] = useState(() => createCreationOperationId());
  const [purgeOperationId] = useState(() => createCreationOperationId());
  const expired = new Date(deletedAt).getTime() + RETENTION_MILLISECONDS <= Date.now();

  const run = (kind: "restore" | "purge") => {
    if (
      kind === "purge" &&
      !confirm("게시물 본문, 댓글, 모든 revision을 영구 삭제합니다. 되돌릴 수 없습니다.")
    ) {
      return;
    }
    startTransition(async () => {
      try {
        const result =
          kind === "restore"
            ? await restorePost(postId, restoreOperationId, version)
            : await purgePost(postId, purgeOperationId, version);
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
            onClick={() => run("purge")}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            영구 삭제
          </Button>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
