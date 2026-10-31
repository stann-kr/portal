"use client";

import { useCallback, useRef } from "react";
import { createFullEditorExtensions } from "./FullEditor";

/** 공동 편집 시드·HTML 변환에 쓸 편집기 확장 목록(화면마다 한 번 만든다). */
export function useEditorExtensions(options?: { preserveBlockIds?: boolean }) {
  const preserveBlockIds = options?.preserveBlockIds ?? false;
  const ref = useRef<ReturnType<typeof createFullEditorExtensions> | null>(null);
  return useCallback(() => {
    ref.current ??= createFullEditorExtensions({ preserveBlockIds });
    return ref.current;
  }, [preserveBlockIds]);
}
