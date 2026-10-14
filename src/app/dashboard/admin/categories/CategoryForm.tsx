"use client";

import { useActionState, useState } from "react";
import { createCategory, type CategoryState } from "@/lib/actions/categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const EMPTY_FIELDS = { name: "", slug: "", description: "", sortOrder: "0" };

export function CategoryForm() {
  // 서버 검증이 실패해도 입력이 사라지지 않도록 controlled field를 사용한다.
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [state, formAction, pending] = useActionState<CategoryState, FormData>(
    async (previous, data) => {
      try {
        const result = await createCategory(previous, data);
        if (result.success) setFields(EMPTY_FIELDS);
        return result;
      } catch {
        return { error: "채널을 추가하지 못했습니다. 다시 시도해 주세요." };
      }
    },
    {},
  );
  const update = (key: keyof typeof EMPTY_FIELDS) =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setFields((current) => ({ ...current, [key]: event.target.value }));

  return (
    <form action={formAction} className="space-y-4" aria-busy={pending}>
      <div className="space-y-2">
        <label htmlFor="name" className="text-sm font-medium">채널 이름</label>
        <Input
          id="name"
          name="name"
          type="text"
          required
          maxLength={60}
          placeholder="예: 장비·셋업"
          value={fields.name}
          onChange={update("name")}
          disabled={pending}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="slug" className="text-sm font-medium">주소 식별자</label>
        <Input
          id="slug"
          name="slug"
          type="text"
          required
          maxLength={60}
          placeholder="예: gear-and-setup"
          aria-describedby="slug-help"
          value={fields.slug}
          onChange={update("slug")}
          disabled={pending}
        />
        <p id="slug-help" className="text-xs text-muted-foreground">영문 소문자, 숫자와 하이픈만 사용할 수 있습니다.</p>
      </div>

      <div className="space-y-2">
        <label htmlFor="description" className="text-sm font-medium">설명 (선택)</label>
        <Input
          id="description"
          name="description"
          type="text"
          maxLength={200}
          placeholder="장비 및 셋업에 관한 이야기"
          value={fields.description}
          onChange={update("description")}
          disabled={pending}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="sortOrder" className="text-sm font-medium">정렬 순서(숫자)</label>
        <Input
          id="sortOrder"
          name="sortOrder"
          type="number"
          value={fields.sortOrder}
          onChange={update("sortOrder")}
          disabled={pending}
        />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-destructive">{state.error}</p>
      )}
      {state.success && (
        <p role="status" className="text-sm text-success">채널을 추가했습니다.</p>
      )}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "추가 중..." : "채널 추가"}
      </Button>
    </form>
  );
}
