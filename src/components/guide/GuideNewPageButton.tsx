"use client";

import { useActionState, useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { useProgressRouter } from "@/components/app-shell/NavigationProgress";
import { Button } from "@/components/ui/button";
import { createGuidePage, type CreateGuidePageState } from "@/lib/actions/guide";
import { CREATION_OPERATION_FIELD, createCreationOperationId } from "@/lib/creation-operation";
import { guidePagePath } from "@/lib/guide-content";

/** 빈 "새 페이지"를 목록 끝에 만들고 바로 편집 화면을 연다. */
export function GuideNewPageButton({ className }: { className?: string }) {
  const router = useProgressRouter();
  const operationInputRef = useRef<HTMLInputElement>(null);
  const [state, formAction, isPending] = useActionState<CreateGuidePageState, FormData>(async (previous, data) => {
    try {
      return await createGuidePage(previous, data);
    } catch {
      return { error: "새 페이지를 만들지 못했습니다. 다시 시도해 주세요." };
    }
  }, {});
  const handledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!state.success || !state.pageId || handledRef.current === state.pageId) return;
    handledRef.current = state.pageId;
    router.push(`${guidePagePath(state.pageId)}/edit`);
  }, [router, state.pageId, state.success]);

  return (
    <form
      action={formAction}
      className={className}
      onSubmit={() => {
        // 누를 때마다 새 생성 의도. 같은 요청의 재전송은 서버가 같은 페이지로 돌려준다.
        if (operationInputRef.current) operationInputRef.current.value = createCreationOperationId();
      }}
    >
      <input ref={operationInputRef} type="hidden" name={CREATION_OPERATION_FIELD} defaultValue="" />
      <input type="hidden" name="title" value="새 페이지" />
      <input type="hidden" name="contentHtml" value="" />
      <Button type="submit" variant="ghost" pending={isPending} className="w-full justify-start">
        {isPending ? null : <Plus className="size-3.5" strokeWidth={1.6} aria-hidden="true" />}
        새 페이지
      </Button>
      {state.error ? <p role="alert" className="mt-1 px-2 text-ui text-destructive">{state.error}</p> : null}
    </form>
  );
}
