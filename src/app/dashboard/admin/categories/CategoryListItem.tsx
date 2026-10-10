"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateCategory, type CategoryState } from "@/lib/actions/categories";
import { DeleteCategoryButton } from "./DeleteCategoryButton";

type Category = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
};

/** 채널 이름·설명·정렬 순서를 목록 안에서 고친다. 게시물이 참조하는 주소 식별자는 읽기 전용이다. */
function EditCategoryForm({ category, onClose }: { category: Category; onClose: () => void }) {
  const [fields, setFields] = useState({
    name: category.name,
    description: category.description ?? "",
    sortOrder: String(category.sortOrder),
  });
  const nameRef = useRef<HTMLInputElement>(null);
  const fieldId = `category-edit-${category.id}`;
  const [state, action, pending] = useActionState<CategoryState, FormData>(
    async (previous, data) => {
      try {
        const result = await updateCategory(category.id, previous, data);
        if (result.success) onClose();
        return result;
      } catch {
        return { error: "채널을 수정하지 못했습니다. 다시 시도해 주세요." };
      }
    },
    {},
  );
  const update = (key: keyof typeof fields) =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setFields((current) => ({ ...current, [key]: event.target.value }));

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  return (
    <form
      action={action}
      aria-label={`${category.name} 채널 수정`}
      aria-busy={pending}
      className="w-full space-y-3"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !pending) onClose();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
        <div className="space-y-1">
          <label htmlFor={`${fieldId}-name`} className="text-xs font-medium text-muted-foreground">채널 이름</label>
          <Input ref={nameRef} id={`${fieldId}-name`} name="name" required maxLength={60} value={fields.name} onChange={update("name")} disabled={pending} />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${fieldId}-sort`} className="text-xs font-medium text-muted-foreground">정렬 순서</label>
          <Input id={`${fieldId}-sort`} name="sortOrder" type="number" step={1} value={fields.sortOrder} onChange={update("sortOrder")} disabled={pending} />
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${fieldId}-description`} className="text-xs font-medium text-muted-foreground">설명 (선택)</label>
        <Input id={`${fieldId}-description`} name="description" maxLength={200} value={fields.description} onChange={update("description")} disabled={pending} />
      </div>
      <p className="text-xs text-muted-foreground">
        주소 식별자 <span className="font-mono">{category.slug}</span>는 기존 게시물이 사용하므로 바꿀 수 없습니다.
      </p>
      {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>{pending ? "저장 중..." : "저장"}</Button>
        <Button type="button" size="sm" variant="outline" onClick={onClose} disabled={pending}>취소</Button>
      </div>
    </form>
  );
}

export function CategoryListItem({ category }: { category: Category }) {
  const [editing, setEditing] = useState(false);
  const editTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (!editing && restoreFocus.current) {
      restoreFocus.current = false;
      editTriggerRef.current?.focus();
    }
  }, [editing]);

  if (editing) {
    return (
      <li className="rounded-lg border border-primary/30 bg-card p-4">
        <EditCategoryForm
          category={category}
          onClose={() => {
            restoreFocus.current = true;
            setEditing(false);
          }}
        />
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card p-4">
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
          <span className="break-words">{category.name}</span>
          <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            {category.slug}
          </span>
        </p>
        {category.description ? (
          <p className="break-words text-sm text-muted-foreground">{category.description}</p>
        ) : null}
        <p className="mt-2 text-xs text-muted-foreground">정렬 우선순위: {category.sortOrder}</p>
      </div>
      <div className="flex shrink-0 items-start gap-1">
        <Button
          ref={editTriggerRef}
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setEditing(true)}
          aria-label={`${category.name} 채널 수정`}
          title="수정"
        >
          <Pencil className="size-4" aria-hidden="true" />
        </Button>
        <DeleteCategoryButton categoryId={category.id} />
      </div>
    </li>
  );
}
