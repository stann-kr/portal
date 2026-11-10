"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import { Input } from "@/components/ui/input";
import { deleteCategory, updateCategory, type CategoryState } from "@/lib/actions/categories";

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
      className="flex w-full flex-col gap-3"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !pending) onClose();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7.5rem]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${fieldId}-name`} className="text-xs text-secondary-foreground">채널 이름</label>
          <Input ref={nameRef} id={`${fieldId}-name`} name="name" required maxLength={60} value={fields.name} onChange={update("name")} disabled={pending} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${fieldId}-sort`} className="text-xs text-secondary-foreground">정렬 순서</label>
          <Input id={`${fieldId}-sort`} name="sortOrder" type="number" step={1} value={fields.sortOrder} onChange={update("sortOrder")} disabled={pending} className="font-mono md:text-ui" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${fieldId}-description`} className="text-xs text-secondary-foreground">설명 (선택)</label>
        <Input id={`${fieldId}-description`} name="description" maxLength={200} value={fields.description} onChange={update("description")} disabled={pending} />
      </div>
      <p className="text-xs text-muted-foreground">
        주소 식별자 <span className="font-mono">{category.slug}</span>는 기존 게시물이 사용하므로 바꿀 수 없습니다.
      </p>
      {state.error ? <p role="alert" className="text-ui text-destructive">{state.error}</p> : null}
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={pending} className="h-11 rounded-touch md:h-8 md:rounded-md">취소</Button>
        <Button type="submit" disabled={pending} className="h-11 rounded-touch md:h-8 md:rounded-md">{pending ? "저장 중..." : "저장"}</Button>
      </div>
    </form>
  );
}

export function CategoryListItem({ category }: { category: Category }) {
  const [editing, setEditing] = useState(false);
  const editTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const deleteConfirm = useConfirmAction();
  const [isDeleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const removeCategory = () => {
    setDeleteError(null);
    startDelete(async () => {
      try {
        const result = await deleteCategory(category.id);
        if (result.error) setDeleteError(result.error);
      } catch {
        setDeleteError("채널을 삭제하지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  useEffect(() => {
    if (!editing && restoreFocus.current) {
      restoreFocus.current = false;
      editTriggerRef.current?.focus();
    }
  }, [editing]);

  if (editing) {
    return (
      <li className="border-b border-muted px-1 py-4">
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
    <li className="flex flex-col gap-3 border-b border-muted px-1 py-3">
      <div className="flex items-center gap-4">
        <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">
          <span className="sr-only">정렬 순서 </span>{category.sortOrder}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="break-words text-body font-medium"># {category.name}</span>
          <span className="break-words text-xs text-muted-foreground">
            <span className="font-mono">{category.slug}</span>
            {category.description ? <> · {category.description}</> : null}
          </span>
        </span>
        <span className="flex shrink-0 gap-1">
          <Button
            ref={editTriggerRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
            aria-label={`${category.name} 채널 수정`}
            className="h-11 rounded-touch px-3 text-ui md:h-7 md:rounded-md md:px-2.5 md:text-xs"
          >
            수정
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(event) => deleteConfirm.request(event.currentTarget)}
            disabled={isDeleting}
            aria-expanded={deleteConfirm.isOpen}
            aria-label={`${category.name} 채널 삭제`}
            className="h-11 rounded-touch px-3 text-ui text-destructive hover:bg-destructive-muted hover:text-destructive md:h-7 md:rounded-md md:px-2.5 md:text-xs"
          >
            삭제
          </Button>
        </span>
      </div>
      {deleteConfirm.isOpen ? (
        <ConfirmPanel
          confirm={deleteConfirm}
          message={`${category.name} 채널을 삭제할까요? 게시물이 있는 채널은 삭제되지 않습니다.`}
          confirmLabel="채널 삭제 확인"
          pendingLabel="삭제 중..."
          pending={isDeleting}
          onConfirm={removeCategory}
          className="ml-10"
        />
      ) : null}
      {deleteError ? <p role="alert" className="ml-10 text-ui text-destructive">{deleteError}</p> : null}
    </li>
  );
}
