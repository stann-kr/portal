"use client";

import { useActionState } from "react";
import { createCategory, type CategoryState } from "@/lib/actions/categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const initialState: CategoryState = {};

export function CategoryForm() {
  const [state, formAction, pending] = useActionState(createCategory, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="name" className="text-sm font-medium">카테고리 이름</label>
        <Input
          id="name"
          name="name"
          type="text"
          required
          placeholder="예: Gear & Setup"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="slug" className="text-sm font-medium">Slug (URL 식별자)</label>
        <Input
          id="slug"
          name="slug"
          type="text"
          required
          placeholder="예: gear-and-setup"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="description" className="text-sm font-medium">설명 (선택)</label>
        <Input
          id="description"
          name="description"
          type="text"
          placeholder="장비 및 셋업에 관한 이야기"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="sortOrder" className="text-sm font-medium">정렬 순서(숫자)</label>
        <Input
          id="sortOrder"
          name="sortOrder"
          type="number"
          defaultValue="0"
        />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      )}
      {state.success && (
        <p role="status" className="text-sm text-success">카테고리가 생성되었습니다.</p>
      )}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "생성 중..." : "카테고리 추가"}
      </Button>
    </form>
  );
}
