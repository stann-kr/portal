"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  purgePrivateNote,
  restorePrivateNote,
} from "@/lib/actions/privateNotes";
import { createCreationOperationId } from "@/lib/creation-operation";

export function NoteTrashActions({
  noteId,
  version,
  canRestore,
  canPurge,
  returnTo,
}: {
  noteId: string;
  version: number;
  canRestore: boolean;
  canPurge: boolean;
  returnTo: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [restoreOperationId] = useState(() => createCreationOperationId());
  const [purgeOperationId] = useState(() => createCreationOperationId());

  const run = (kind: "restore" | "purge") => {
    if (
      kind === "purge" &&
      !confirm("노트 본문과 모든 revision을 영구 삭제합니다. 이 작업은 되돌릴 수 없습니다.")
    ) {
      return;
    }
    startTransition(async () => {
      const operationId =
        kind === "restore" ? restoreOperationId : purgeOperationId;
      const result =
        kind === "restore"
          ? await restorePrivateNote(noteId, operationId, version)
          : await purgePrivateNote(noteId, operationId, version);
      if (!result.success) {
        setError(result.error ?? "노트 상태를 변경하지 못했습니다.");
        return;
      }
      setError(null);
      if (kind === "purge") {
        router.push(returnTo);
      } else {
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canRestore ? (
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={isPending}
            onClick={() => run("restore")}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            노트 복원
          </Button>
        ) : null}
        {canPurge ? (
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
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
