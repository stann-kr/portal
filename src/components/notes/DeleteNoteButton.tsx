"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { trashPrivateNote } from "@/lib/actions/privateNotes";
import { createCreationOperationId } from "@/lib/creation-operation";

export function DeleteNoteButton({
  noteId,
  version,
}: {
  noteId: string;
  version: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const requestKey = JSON.stringify([noteId, version]);
  const operation = useRef<{ key: string; id: string } | null>(null);
  const trashConfirm = useConfirmAction();

  const handleDelete = () => {
    if (isPending) return;
    if (operation.current?.key !== requestKey) {
      operation.current = { key: requestKey, id: createCreationOperationId() };
    }
    const operationId = operation.current.id;
    setError(null);
    startTransition(async () => {
      try {
        const result = await trashPrivateNote(noteId, operationId, version);
        if (!result.success) {
          setError(result.error ?? "노트를 휴지통으로 이동하지 못했습니다.");
          return;
        }
        setError(null);
        router.refresh();
      } catch {
        setError("노트를 휴지통으로 이동한 결과를 확인하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={(event) => trashConfirm.request(event.currentTarget)}
        disabled={isPending}
        aria-expanded={trashConfirm.isOpen}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        title="휴지통으로 이동"
        aria-label="노트를 휴지통으로 이동"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
      {trashConfirm.isOpen ? (
        <ConfirmPanel
          confirm={trashConfirm}
          message="이 노트를 휴지통으로 이동할까요? 30일 동안 복원할 수 있습니다."
          confirmLabel="휴지통 이동 확인"
          pendingLabel="이동 중..."
          pending={isPending}
          onConfirm={handleDelete}
          className="w-72 max-w-full text-left"
        />
      ) : null}
      {error ? (
        <span role="alert" className="max-w-64 text-right text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
