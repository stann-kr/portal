"use client";

import { useState, useTransition } from "react";
import { deleteCategory } from "@/lib/actions/categories";
import { Trash2 } from "lucide-react";

export function DeleteCategoryButton({ categoryId }: { categoryId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleDelete = () => {
    if (confirm("정말 이 카테고리를 삭제하시겠습니까?")) {
      setError(null);
      startTransition(async () => {
        const result = await deleteCategory(categoryId);
        if (result.error) setError(result.error);
      });
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleDelete}
        disabled={isPending}
        className="p-2 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
        aria-label="카테고리 삭제"
        title="삭제"
      >
        <Trash2 className="w-4 h-4" />
      </button>
      {error ? <p role="alert" className="max-w-48 text-right text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
