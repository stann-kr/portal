"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { restorePrivateNoteRevision } from "@/lib/actions/privateNotes";
import { createCreationOperationId } from "@/lib/creation-operation";

export function RestoreNoteRevisionButton({
  noteId,
  baseRevision,
  revisionNumber,
}: {
  noteId: string;
  baseRevision: number;
  revisionNumber: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [operationId] = useState(() => createCreationOperationId());

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={isPending || revisionNumber === baseRevision}
        onClick={() => {
          if (!confirm(`${revisionNumber}번 버전의 내용을 새 현재 버전으로 복원하시겠습니까? 기존 이력은 유지됩니다.`)) {
            return;
          }
          startTransition(async () => {
            const result = await restorePrivateNoteRevision(
              noteId,
              operationId,
              baseRevision,
              revisionNumber,
            );
            if (!result.success) {
              setError(result.error ?? "이 버전을 복원하지 못했습니다.");
              return;
            }
            setError(null);
            router.refresh();
          });
        }}
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        {revisionNumber === baseRevision ? "현재 버전" : "이 버전 복원"}
      </Button>
      {error ? (
        <p role="alert" className="max-w-72 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
