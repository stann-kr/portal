"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
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
  const [operationId] = useState(() => createCreationOperationId());

  const handleDelete = () => {
    if (!confirm("이 노트를 휴지통으로 이동하시겠습니까? 30일 동안 복원할 수 있습니다.")) {
      return;
    }
    startTransition(async () => {
      const result = await trashPrivateNote(noteId, operationId, version);
      if (!result.success) {
        setError(result.error ?? "노트를 휴지통으로 이동하지 못했습니다.");
        return;
      }
      setError(null);
      router.refresh();
    });
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        title="휴지통으로 이동"
        aria-label="노트를 휴지통으로 이동"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
      {error ? (
        <span role="alert" className="max-w-64 text-right text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
