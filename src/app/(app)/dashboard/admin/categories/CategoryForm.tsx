"use client";

import { useActionState, useState } from "react";
import { createCategory, type CategoryState } from "@/lib/actions/categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type CategoryFields = { name: string; slug: string; description: string; sortOrder: string };

const LABEL_CLASS = "flex flex-col gap-1.5 text-ui text-secondary-foreground md:text-xs";

/** 새 채널 추가(캔버스 AdminCategories 왼쪽 열). */
export function CategoryForm({ defaultSortOrder = 0 }: { defaultSortOrder?: number }) {
  const emptyFields = (): CategoryFields => ({ name: "", slug: "", description: "", sortOrder: String(defaultSortOrder) });
  // 서버 검증이 실패해도 입력이 사라지지 않도록 controlled field를 사용한다.
  const [fields, setFields] = useState<CategoryFields>(emptyFields);
  const [state, formAction, pending] = useActionState<CategoryState, FormData>(
    async (previous, data) => {
      try {
        const result = await createCategory(previous, data);
        if (result.success) {
          // 방금 추가한 채널 뒤의 순서를 다음 기본값으로 둔다.
          const added = Number(data.get("sortOrder"));
          setFields({ name: "", slug: "", description: "", sortOrder: String(Number.isSafeInteger(added) ? Math.max(added + 1, defaultSortOrder) : defaultSortOrder) });
        }
        return result;
      } catch {
        return { error: "채널을 추가하지 못했습니다. 다시 시도해 주세요." };
      }
    },
    {},
  );
  const update = (key: keyof CategoryFields) =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setFields((current) => ({ ...current, [key]: event.target.value }));

  return (
    <form action={formAction} className="flex flex-col gap-4" aria-busy={pending}>
      <label htmlFor="name" className={LABEL_CLASS}>
        채널 이름
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
      </label>

      <div className={LABEL_CLASS}>
        <label htmlFor="slug">주소 식별자</label>
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
          className="font-mono md:text-ui"
        />
        <span id="slug-help" className="text-xs text-muted-foreground">영문 소문자, 숫자와 하이픈만 사용할 수 있습니다.</span>
      </div>

      <label htmlFor="description" className={LABEL_CLASS}>
        설명 (선택)
        <Input
          id="description"
          name="description"
          type="text"
          maxLength={200}
          value={fields.description}
          onChange={update("description")}
          disabled={pending}
        />
      </label>

      <label htmlFor="sortOrder" className={LABEL_CLASS}>
        정렬 순서(숫자)
        <Input
          id="sortOrder"
          name="sortOrder"
          type="number"
          value={fields.sortOrder}
          onChange={update("sortOrder")}
          disabled={pending}
          className="w-30 font-mono md:text-ui"
        />
      </label>

      {state.error && (
        <p role="alert" className="text-ui text-destructive">{state.error}</p>
      )}
      {state.success && (
        <p role="status" className="text-ui text-success">채널을 추가했습니다.</p>
      )}

      <Button type="submit" disabled={pending} size="touch" className="w-full md:h-8 md:w-auto md:self-start md:rounded-md md:px-3.5 md:text-ui">
        {pending ? "추가 중..." : "채널 추가"}
      </Button>
    </form>
  );
}
