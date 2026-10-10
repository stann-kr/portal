"use client";

import { useState, useTransition } from "react";
import { deleteCategory } from "@/lib/actions/categories";
import { Trash2 } from "lucide-react";

export function DeleteCategoryButton({ categoryId }: { categoryId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleDelete = () => {
    if (confirm("이 채널을 삭제할까요? 게시물이 있는 채널은 삭제되지 않습니다.")) {
      setError(null);
      startTransition(async () => {
        try {
          const result = await deleteCategory(categoryId);
          if (result.error) setError(result.error);
        } catch {
          setError("채널을 삭제하지 못했습니다. 다시 시도해 주세요.");
        }
      });
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending}
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        aria-label="채널 삭제"
        title="삭제"
      >
        <Trash2 className="w-4 h-4" aria-hidden="true" />
      </button>
      {error ? <p role="alert" className="max-w-48 text-right text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
