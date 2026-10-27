"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
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
  const requestKey = JSON.stringify([noteId, version]);
  const operations = useRef<{ key: string; restore: string; purge: string } | null>(null);

  const purgeConfirm = useConfirmAction();

  const run = (kind: "restore" | "purge") => {
    if (isPending) return;
    if (operations.current?.key !== requestKey) {
      operations.current = { key: requestKey, restore: createCreationOperationId(), purge: createCreationOperationId() };
    }
    const operationId = operations.current[kind];
    setError(null);
    startTransition(async () => {
      try {
        const result = kind === "restore"
          ? await restorePrivateNote(noteId, operationId, version)
          : await purgePrivateNote(noteId, operationId, version);
        if (!result.success) {
          setError(result.error ?? "노트 상태를 변경하지 못했습니다.");
          return;
        }
        setError(null);
        if (kind === "purge") router.push(returnTo);
        else router.refresh();
      } catch {
        setError("노트 상태를 변경한 결과를 확인하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  return (
    <div className="flex min-w-0 max-w-md flex-col items-start gap-3">
      <div className="flex flex-wrap gap-2">
        {canRestore ? (
          <Button
            type="button"
            variant="outline"
            className="max-md:h-11"
            disabled={isPending}
            onClick={() => run("restore")}
          >
            노트 복원
          </Button>
        ) : null}
        {canPurge ? (
          <Button
            type="button"
            variant="destructive"
            className="max-md:h-11"
            disabled={isPending}
            aria-expanded={purgeConfirm.isOpen}
            onClick={(event) => purgeConfirm.request(event.currentTarget)}
          >
            영구 삭제
          </Button>
        ) : null}
      </div>
      {purgeConfirm.isOpen ? (
        <ConfirmPanel
          confirm={purgeConfirm}
          message="노트 본문과 모든 revision을 영구 삭제합니다. 이 작업은 되돌릴 수 없습니다."
          confirmLabel="영구 삭제 확인"
          pendingLabel="삭제 중..."
          pending={isPending}
          onConfirm={() => run("purge")}
          className="w-full"
        />
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
